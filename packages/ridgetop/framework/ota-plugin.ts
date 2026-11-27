import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface EmitOtaPluginOptions {
  /** Optional base64-encoded raw 32-byte Ed25519 public key baked into native Swift & Java binaries. */
  readonly publicKeyBase64?: string
  /** Optional allowed HTTPS host for non-local OTA downloads (e.g. `cjenaro.github.io`). */
  readonly allowedHost?: string
  /** Whether Layer-1 `local` LAN HTTP testing is compiled into this build (false for `prod` builds). */
  readonly allowLocal?: boolean
}

const CAP_CORE_SPECIFIER = '@capacitor/core'

const PLUGIN_PACKAGE_JSON = JSON.stringify({
  name: 'ridgetop-ota',
  version: '1.0.0',
  description: 'Zero-dependency native Over-the-Air (OTA) bundle updater for Ridgetop Capacitor apps (iOS & Android).',
  main: 'dist/plugin.cjs.js',
  module: 'dist/esm/index.js',
  types: 'dist/esm/index.d.ts',
  files: [
    'android/build.gradle',
    'android/src/main/',
    'dist/',
    'ios/Sources/',
    'Package.swift',
    'RidgetopOta.podspec'
  ],
  capacitor: {
    ios: { src: 'ios' },
    android: { src: 'android' }
  },
  peerDependencies: {
    '@capacitor/core': '^8.0.0'
  }
}, null, 2) + '\n'

const PLUGIN_ESM_JS = [
  ['import { registerPlugin } from', JSON.stringify(CAP_CORE_SPECIFIER)].join(' '),
  '',
  "export const RidgetopOta = registerPlugin('RidgetopOta')",
  ''
].join('\n')

const PLUGIN_CJS_JS = [
  "'use strict'",
  `const { registerPlugin } = require(${JSON.stringify(CAP_CORE_SPECIFIER)})`,
  "exports.RidgetopOta = registerPlugin('RidgetopOta')",
  ''
].join('\n')

const PLUGIN_DTS = `export interface RidgetopOtaPluginStatus {
  appId: string
  nativeVersion: string
  nativeBuild: string
  activeVersion: string | null
  stagedVersion: string | null
  lastGoodVersion: string | null
  failedVersion: string | null
  isOtaActive: boolean
  signatureRequired: boolean
}

export interface RidgetopOtaPlugin {
  downloadAndStage(options: {
    url: string
    version: string
    sha256: string
    channel?: string
    minNativeVersion?: string
    signature?: string
  }): Promise<{ version: string; staged: boolean }>
  apply(options?: { reload?: boolean }): Promise<{ applied: boolean; version: string | null }>
  confirmReady(options?: { version?: string }): Promise<{ confirmed: boolean; version: string | null }>
  reset(): Promise<{ reset: boolean }>
  getStatus(): Promise<RidgetopOtaPluginStatus>
}

export declare const RidgetopOta: RidgetopOtaPlugin
`

const PACKAGE_SWIFT = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RidgetopOta",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "RidgetopOta",
            targets: ["RidgetopOtaPlugin"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "RidgetopOtaPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/RidgetopOtaPlugin"
        )
    ]
)
`

const PODSPEC = `Pod::Spec.new do |s|
  s.name = 'RidgetopOta'
  s.version = '1.0.0'
  s.summary = 'Zero-dependency OTA bundle updater for Ridgetop Capacitor apps'
  s.license = 'MIT'
  s.homepage = 'https://github.com/cjenaro/ridgetop'
  s.author = 'Ridgetop'
  s.source = { :path => '.' }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
`

function escapeNativeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '')
}

function renderIosSwiftPlugin(pinnedPublicKey: string, allowedHost: string, allowLocal: boolean): string {
  return `import Foundation
import Capacitor
import CryptoKit
import Compression

private final class OtaSessionDelegate: NSObject, URLSessionDownloadDelegate {
    let allowLocalHttp: Bool
    let allowedHost: String
    let maxZipBytes: Int64

    init(allowLocalHttp: Bool, allowedHost: String, maxZipBytes: Int64) {
        self.allowLocalHttp = allowLocalHttp
        self.allowedHost = allowedHost
        self.maxZipBytes = maxZipBytes
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        if let url = request.url, RidgetopOtaPlugin.isAllowedDownloadUrl(url, allowLocalHttp: allowLocalHttp, allowedHost: allowedHost) {
            completionHandler(request)
        } else {
            completionHandler(nil)
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        if totalBytesWritten > maxZipBytes || (totalBytesExpectedToWrite > 0 && totalBytesExpectedToWrite > maxZipBytes) {
            downloadTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // Completion-handler downloadTask handles the file synchronously.
    }
}

@objc(RidgetopOtaPlugin)
public class RidgetopOtaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RidgetopOtaPlugin"
    public let jsName = "RidgetopOta"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "downloadAndStage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "apply", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirmReady", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    private static let pinnedPublicKeyBase64 = "${escapeNativeString(pinnedPublicKey)}"
    private static let allowedHost = "${escapeNativeString(allowedHost)}"
    private static let allowLocalChannel = ${allowLocal ? 'true' : 'false'}
    private static let maxZipBytes = 50 * 1024 * 1024
    private static let maxEntries = 2000
    private static let maxFileBytes = 20 * 1024 * 1024
    private static let maxTotalExtractedBytes = 100 * 1024 * 1024

    private let workQueue = DispatchQueue(label: "com.ridgetop.ota.serial")
    private let defaults = UserDefaults.standard
    private let keyNativeBuild = "ridgetop.ota.nativeBuild"
    private let keyActive = "ridgetop.ota.activeVersion"
    private let keyStaged = "ridgetop.ota.stagedVersion"
    private let keyLastGood = "ridgetop.ota.lastGoodVersion"
    private let keyFailed = "ridgetop.ota.failedVersion"
    private let keyPending = "ridgetop.ota.pending"
    private var servedOtaVersion: String?

    private var appIdString: String {
        Bundle.main.bundleIdentifier ?? ""
    }

    private var nativeVersionString: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0.0"
    }

    private var nativeBuildString: String {
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "1"
    }

    private var nativeSignature: String {
        "\\(nativeVersionString)(\\(nativeBuildString))"
    }

    private var bundlesRoot: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        var root = base.appendingPathComponent("ridgetop-ota/bundles", isDirectory: true).standardizedFileURL
        if !FileManager.default.fileExists(atPath: root.path) {
            try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? root.setResourceValues(values)
        }
        return root
    }

    private static func sanitizeVersion(_ version: String) -> String {
        var ascii = ""
        for scalar in version.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars {
            let v = scalar.value
            let ok = (v >= 0x30 && v <= 0x39) || (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A)
                || v == 0x2E || v == 0x5F || v == 0x2B || v == 0x2D
            ascii.append(ok ? Character(scalar) : "-")
        }
        while ascii.contains("..") {
            ascii = ascii.replacingOccurrences(of: "..", with: "-")
        }
        let trimmed = ascii.trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
        let capped = String(trimmed.prefix(128))
        return capped.isEmpty ? "0.0.0" : capped
    }

    private func bundleDir(for version: String) -> URL? {
        let safe = Self.sanitizeVersion(version)
        let candidate = bundlesRoot.appendingPathComponent(safe, isDirectory: true).standardizedFileURL
        guard candidate.deletingLastPathComponent().path == bundlesRoot.path else {
            return nil
        }
        return candidate
    }

    private func isValidBundle(_ version: String) -> Bool {
        guard let dir = bundleDir(for: version) else { return false }
        return FileManager.default.fileExists(atPath: dir.appendingPathComponent("index.html").path)
    }

    private static func isPrivateLanHost(_ host: String) -> Bool {
        let lower = host.lowercased()
        if lower == "localhost" || lower == "127.0.0.1" { return true }
        let parts = lower.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4, parts.allSatisfy({ $0 >= 0 && $0 <= 255 }) else { return false }
        if parts[0] == 10 { return true }
        if parts[0] == 192 && parts[1] == 168 { return true }
        if parts[0] == 172 && parts[1] >= 16 && parts[1] <= 31 { return true }
        return false
    }

    static func isAllowedDownloadUrl(_ url: URL, allowLocalHttp: Bool, allowedHost: String) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), !host.isEmpty else {
            return false
        }
        if scheme == "https" {
            if !allowedHost.isEmpty {
                return host == allowedHost.lowercased()
            }
            return true
        }
        if scheme == "http" && allowLocalHttp {
            return isPrivateLanHost(host)
        }
        return false
    }

    private func verifyManifestSignature(
        channel: String,
        version: String,
        minNativeVersion: String,
        sha256: String,
        signatureBase64: String?
    ) -> Bool {
        guard !Self.pinnedPublicKeyBase64.isEmpty else { return true }
        if channel == "local" && Self.allowLocalChannel { return true }
        guard let sigStr = signatureBase64,
              let sigData = Data(base64Encoded: sigStr),
              let pubData = Data(base64Encoded: Self.pinnedPublicKeyBase64),
              let pubKey = try? Curve25519.Signing.PublicKey(rawRepresentation: pubData) else {
            return false
        }
        let canonical = [
            "ridgetop-ota-v1",
            appIdString,
            channel,
            version,
            minNativeVersion,
            sha256.lowercased()
        ].joined(separator: "\\n")
        return pubKey.isValidSignature(sigData, for: Data(canonical.utf8))
    }

    private func clearAllOtaState() {
        servedOtaVersion = nil
        defaults.removeObject(forKey: keyActive)
        defaults.removeObject(forKey: keyStaged)
        defaults.removeObject(forKey: keyLastGood)
        defaults.removeObject(forKey: keyFailed)
        defaults.set(false, forKey: keyPending)
        try? FileManager.default.removeItem(at: bundlesRoot)
    }

    private func switchWebViewBasePath(_ path: String, forceReload: Bool) {
        let applyPath = { [weak self] in
            guard let self = self, let bridge = self.bridge else { return }
            if forceReload || bridge.webView?.url != nil {
                if let vc = bridge.viewController as? CAPBridgeViewController {
                    vc.setServerBasePath(path: path)
                } else {
                    bridge.setServerBasePath(path)
                    if let url = bridge.config.serverURL {
                        bridge.webView?.load(URLRequest(url: url))
                    }
                }
            } else {
                bridge.setServerBasePath(path)
            }
        }
        if Thread.isMainThread {
            applyPath()
        } else {
            DispatchQueue.main.async(execute: applyPath)
        }
    }

    override public func load() {
        var pathToLoad: String?
        workQueue.sync {
            let storedNative = defaults.string(forKey: keyNativeBuild)
            if storedNative != nativeSignature {
                clearAllOtaState()
                defaults.set(nativeSignature, forKey: keyNativeBuild)
                return
            }

            if defaults.bool(forKey: keyPending) {
                if let bad = defaults.string(forKey: keyActive) {
                    defaults.set(bad, forKey: keyFailed)
                    if let badDir = bundleDir(for: bad) {
                        try? FileManager.default.removeItem(at: badDir)
                    }
                }
                if let lastGood = defaults.string(forKey: keyLastGood), isValidBundle(lastGood) {
                    defaults.set(lastGood, forKey: keyActive)
                } else {
                    defaults.removeObject(forKey: keyActive)
                }
                defaults.set(false, forKey: keyPending)
            }

            if let staged = defaults.string(forKey: keyStaged), isValidBundle(staged) {
                defaults.set(staged, forKey: keyActive)
                defaults.removeObject(forKey: keyStaged)
                defaults.set(true, forKey: keyPending)
            }

            if let active = defaults.string(forKey: keyActive), let dir = bundleDir(for: active), isValidBundle(active) {
                servedOtaVersion = active
                pathToLoad = dir.path
            }
        }
        if let path = pathToLoad {
            switchWebViewBasePath(path, forceReload: false)
        }
    }

    @objc func downloadAndStage(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              let version = call.getString("version"),
              let expectedSha = call.getString("sha256")?.lowercased(),
              !version.isEmpty,
              expectedSha.count == 64 else {
            call.reject("Missing or invalid parameters: url, version, sha256")
            return
        }

        let channel = call.getString("channel") ?? "prod"
        let minNativeVersion = call.getString("minNativeVersion") ?? "0.0.0"
        let signature = call.getString("signature")
        let allowLocalHttp = (channel == "local") && Self.allowLocalChannel

        guard Self.isAllowedDownloadUrl(url, allowLocalHttp: allowLocalHttp, allowedHost: Self.allowedHost) else {
            call.reject("Disallowed OTA download URL")
            return
        }
        guard verifyManifestSignature(
            channel: channel,
            version: version,
            minNativeVersion: minNativeVersion,
            sha256: expectedSha,
            signatureBase64: signature
        ) else {
            call.reject("Invalid or missing OTA manifest signature")
            return
        }

        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 60

        let delegate = OtaSessionDelegate(
            allowLocalHttp: allowLocalHttp,
            allowedHost: Self.allowedHost,
            maxZipBytes: Int64(Self.maxZipBytes)
        )
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

        let task = session.downloadTask(with: url) { [weak self] tempFileUrl, response, error in
            defer { session.finishTasksAndInvalidate() }
            guard let self = self else { return }
            if let error = error {
                call.reject("Download failed: \\(error.localizedDescription)")
                return
            }
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                call.reject("Download failed with non-2xx HTTP response")
                return
            }
            guard let downloadedUrl = tempFileUrl else {
                call.reject("Empty OTA bundle response")
                return
            }

            let attrs = try? FileManager.default.attributesOfItem(atPath: downloadedUrl.path)
            let fileSize = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            guard fileSize > 0 && fileSize <= Self.maxZipBytes else {
                try? FileManager.default.removeItem(at: downloadedUrl)
                call.reject("OTA bundle size out of allowed bounds")
                return
            }

            // Synchronously move the URLSession temp file to an owned path before returning from the handler.
            let ownedZipUrl = self.bundlesRoot.appendingPathComponent(".tmp-dl-\\(UUID().uuidString).zip")
            do {
                try FileManager.default.moveItem(at: downloadedUrl, to: ownedZipUrl)
            } catch {
                try? FileManager.default.removeItem(at: downloadedUrl)
                call.reject("Could not persist downloaded OTA bundle")
                return
            }

            self.workQueue.async {
                defer { try? FileManager.default.removeItem(at: ownedZipUrl) }
                guard let zipData = try? Data(contentsOf: ownedZipUrl) else {
                    call.reject("Could not read downloaded OTA bundle")
                    return
                }
                let digest = SHA256.hash(data: zipData)
                let actualSha = digest.map { String(format: "%02x", $0) }.joined()
                guard actualSha == expectedSha else {
                    call.reject("OTA bundle integrity check failed")
                    return
                }
                if let active = self.defaults.string(forKey: self.keyActive),
                   Self.sanitizeVersion(active) == Self.sanitizeVersion(version) {
                    call.reject("Cannot overwrite currently active OTA bundle")
                    return
                }
                guard let targetDir = self.bundleDir(for: version) else {
                    call.reject("Invalid OTA version directory")
                    return
                }
                let tempDir = self.bundlesRoot.appendingPathComponent(".tmp-\\(UUID().uuidString)", isDirectory: true)
                do {
                    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
                    try Self.extractZip(data: zipData, to: tempDir)
                    guard FileManager.default.fileExists(atPath: tempDir.appendingPathComponent("index.html").path) else {
                        try? FileManager.default.removeItem(at: tempDir)
                        call.reject("OTA bundle missing index.html")
                        return
                    }
                    if FileManager.default.fileExists(atPath: targetDir.path) {
                        try FileManager.default.removeItem(at: targetDir)
                    }
                    try FileManager.default.moveItem(at: tempDir, to: targetDir)
                    self.defaults.set(version, forKey: self.keyStaged)
                    call.resolve(["version": version, "staged": true])
                } catch {
                    try? FileManager.default.removeItem(at: tempDir)
                    call.reject("Extract failed: \\(error.localizedDescription)")
                }
            }
        }
        task.resume()
    }

    @objc func apply(_ call: CAPPluginCall) {
        let shouldReload = call.getBool("reload") ?? true
        workQueue.async { [weak self] in
            guard let self = self else { return }
            guard let staged = self.defaults.string(forKey: self.keyStaged),
                  let dir = self.bundleDir(for: staged),
                  self.isValidBundle(staged) else {
                call.resolve(["applied": false, "version": NSNull()])
                return
            }
            if !shouldReload {
                // Leave in keyStaged so load() promotes and marks pending on the next launch.
                call.resolve(["applied": true, "version": staged])
                return
            }
            self.defaults.set(staged, forKey: self.keyActive)
            self.defaults.removeObject(forKey: self.keyStaged)
            self.defaults.set(true, forKey: self.keyPending)
            self.servedOtaVersion = staged
            self.switchWebViewBasePath(dir.path, forceReload: true)
            call.resolve(["applied": true, "version": staged])
        }
    }

    @objc func confirmReady(_ call: CAPPluginCall) {
        let expectedVersion = call.getString("version")
        workQueue.async { [weak self] in
            guard let self = self else { return }
            let active = self.defaults.string(forKey: self.keyActive)
            if let active = active {
                if self.servedOtaVersion != active {
                    call.resolve(["confirmed": false, "version": NSNull()])
                    return
                }
                if let expected = expectedVersion, !expected.isEmpty, expected != active {
                    call.resolve(["confirmed": false, "version": NSNull()])
                    return
                }
                self.defaults.set(false, forKey: self.keyPending)
                self.defaults.set(active, forKey: self.keyLastGood)
                var keep = Set<String>([Self.sanitizeVersion(active)])
                if let staged = self.defaults.string(forKey: self.keyStaged) {
                    keep.insert(Self.sanitizeVersion(staged))
                }
                self.pruneOldBundles(keeping: keep)
                call.resolve(["confirmed": true, "version": active])
            } else {
                self.defaults.set(false, forKey: self.keyPending)
                call.resolve(["confirmed": true, "version": NSNull()])
            }
        }
    }

    @objc func reset(_ call: CAPPluginCall) {
        workQueue.async { [weak self] in
            guard let self = self else { return }
            self.clearAllOtaState()
            self.defaults.set(self.nativeSignature, forKey: self.keyNativeBuild)
            if let builtIn = Bundle.main.resourceURL?.appendingPathComponent("public").path {
                self.switchWebViewBasePath(builtIn, forceReload: true)
            }
            call.resolve(["reset": true])
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        workQueue.async { [weak self] in
            guard let self = self else { return }
            let active = self.defaults.string(forKey: self.keyActive)
            call.resolve([
                "appId": self.appIdString,
                "nativeVersion": self.nativeVersionString,
                "nativeBuild": self.nativeBuildString,
                "activeVersion": active ?? NSNull(),
                "stagedVersion": self.defaults.string(forKey: self.keyStaged) ?? NSNull(),
                "lastGoodVersion": self.defaults.string(forKey: self.keyLastGood) ?? NSNull(),
                "failedVersion": self.defaults.string(forKey: self.keyFailed) ?? NSNull(),
                "isOtaActive": active != nil && self.isValidBundle(active!),
                "signatureRequired": !Self.pinnedPublicKeyBase64.isEmpty
            ])
        }
    }

    private func pruneOldBundles(keeping: Set<String>) {
        guard let items = try? FileManager.default.contentsOfDirectory(at: bundlesRoot, includingPropertiesForKeys: nil) else {
            return
        }
        for item in items {
            let name = item.lastPathComponent
            if name.hasPrefix(".tmp-dl-") || keeping.contains(name) { continue }
            try? FileManager.default.removeItem(at: item)
        }
    }

    private static func decodeRawDeflateStreaming(
        bytes: [UInt8],
        start: Int,
        compSize: Int,
        expectedSize: Int
    ) throws -> Data {
        guard compSize > 0 else {
            throw NSError(domain: "RidgetopOta", code: 8, userInfo: [NSLocalizedDescriptionKey: "Empty deflate payload for non-empty entry"])
        }
        let dummyDst = UnsafeMutablePointer<UInt8>.allocate(capacity: 1)
        let dummySrc = UnsafeMutablePointer<UInt8>.allocate(capacity: 1)
        defer {
            dummyDst.deallocate()
            dummySrc.deallocate()
        }
        var stream = compression_stream(dst_ptr: dummyDst, dst_size: 0, src_ptr: dummySrc, src_size: 0, state: nil)
        guard compression_stream_init(&stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
            throw NSError(domain: "RidgetopOta", code: 8, userInfo: [NSLocalizedDescriptionKey: "Failed to initialize deflate decoder"])
        }
        defer { compression_stream_destroy(&stream) }

        let chunkSize = 65536
        var outChunk = [UInt8](repeating: 0, count: chunkSize)
        var result = Data()

        try bytes.withUnsafeBufferPointer { buf in
            guard let base = buf.baseAddress else {
                throw NSError(domain: "RidgetopOta", code: 8, userInfo: [NSLocalizedDescriptionKey: "Invalid buffer"])
            }
            stream.src_ptr = base.advanced(by: start)
            stream.src_size = compSize

            while true {
                let prevSrcSize = stream.src_size
                let status: compression_status = outChunk.withUnsafeMutableBufferPointer { dstBuf in
                    stream.dst_ptr = dstBuf.baseAddress!
                    stream.dst_size = chunkSize
                    return compression_stream_process(&stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                }
                let produced = chunkSize - stream.dst_size
                if produced > 0 {
                    if result.count + produced > expectedSize || result.count + produced > maxFileBytes {
                        throw NSError(domain: "RidgetopOta", code: 10, userInfo: [NSLocalizedDescriptionKey: "ZIP entry exceeds declared or max file size"])
                    }
                    result.append(outChunk, count: produced)
                }
                if status == COMPRESSION_STATUS_END {
                    break
                }
                if status == COMPRESSION_STATUS_ERROR || (produced == 0 && stream.src_size == prevSrcSize) {
                    throw NSError(domain: "RidgetopOta", code: 8, userInfo: [NSLocalizedDescriptionKey: "Corrupt deflate stream"])
                }
            }
        }

        guard result.count == expectedSize else {
            throw NSError(domain: "RidgetopOta", code: 8, userInfo: [NSLocalizedDescriptionKey: "Deflate size mismatch"])
        }
        return result
    }

    // Minimal zero-dependency ZIP extractor with streaming decompression and zip-bomb / zip-slip guards.
    private static func extractZip(data: Data, to destination: URL) throws {
        let bytes = [UInt8](data)
        let count = bytes.count
        guard count >= 22 else { throw NSError(domain: "RidgetopOta", code: 1, userInfo: [NSLocalizedDescriptionKey: "Truncated ZIP archive"]) }

        func u16(_ offset: Int) -> Int {
            Int(bytes[offset]) | (Int(bytes[offset + 1]) << 8)
        }
        func u32(_ offset: Int) -> Int {
            Int(bytes[offset]) | (Int(bytes[offset + 1]) << 8) | (Int(bytes[offset + 2]) << 16) | (Int(bytes[offset + 3]) << 24)
        }

        var eocd = -1
        let minOffset = max(0, count - 65557)
        for i in stride(from: count - 22, through: minOffset, by: -1) {
            if bytes[i] == 0x50 && bytes[i + 1] == 0x4b && bytes[i + 2] == 0x05 && bytes[i + 3] == 0x06 {
                let commentLen = u16(i + 20)
                if i + 22 + commentLen == count {
                    eocd = i
                    break
                }
            }
        }
        guard eocd >= 0 else { throw NSError(domain: "RidgetopOta", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid ZIP: missing EOCD"]) }

        let totalEntries = u16(eocd + 10)
        guard totalEntries <= maxEntries else {
            throw NSError(domain: "RidgetopOta", code: 11, userInfo: [NSLocalizedDescriptionKey: "ZIP exceeds max entry count"])
        }
        var cdOffset = u32(eocd + 16)
        let destRoot = destination.standardizedFileURL.path
        var totalExtracted = 0

        for _ in 0..<totalEntries {
            guard cdOffset + 46 <= count, u32(cdOffset) == 0x02014b50 else {
                throw NSError(domain: "RidgetopOta", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid ZIP central directory"])
            }
            let method = u16(cdOffset + 10)
            let compSize = u32(cdOffset + 20)
            let uncompSize = u32(cdOffset + 24)
            let nameLen = u16(cdOffset + 28)
            let extraLen = u16(cdOffset + 30)
            let commentLen = u16(cdOffset + 32)
            let localOffset = u32(cdOffset + 42)
            guard cdOffset + 46 + nameLen <= count else {
                throw NSError(domain: "RidgetopOta", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid ZIP entry name"])
            }
            let nameData = Data(bytes[(cdOffset + 46)..<(cdOffset + 46 + nameLen)])
            guard let relPath = String(data: nameData, encoding: .utf8),
                  !relPath.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) else {
                throw NSError(domain: "RidgetopOta", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid UTF-8 or control characters in ZIP entry name"])
            }
            cdOffset += 46 + nameLen + extraLen + commentLen

            if relPath.isEmpty || relPath.hasSuffix("/") { continue }
            guard uncompSize <= maxFileBytes else {
                throw NSError(domain: "RidgetopOta", code: 10, userInfo: [NSLocalizedDescriptionKey: "ZIP entry exceeds max file size"])
            }
            totalExtracted += uncompSize
            guard totalExtracted <= maxTotalExtractedBytes else {
                throw NSError(domain: "RidgetopOta", code: 12, userInfo: [NSLocalizedDescriptionKey: "ZIP exceeds max total extracted size"])
            }

            let targetUrl = destination.appendingPathComponent(relPath).standardizedFileURL
            guard targetUrl.path.hasPrefix(destRoot + "/") else {
                throw NSError(domain: "RidgetopOta", code: 5, userInfo: [NSLocalizedDescriptionKey: "Blocked zip-slip entry"])
            }

            guard localOffset + 30 <= count, u32(localOffset) == 0x04034b50 else {
                throw NSError(domain: "RidgetopOta", code: 6, userInfo: [NSLocalizedDescriptionKey: "Invalid ZIP local header"])
            }
            let localNameLen = u16(localOffset + 26)
            let localExtraLen = u16(localOffset + 28)
            let dataStart = localOffset + 30 + localNameLen + localExtraLen
            let dataEnd = dataStart + compSize
            guard dataEnd <= count else {
                throw NSError(domain: "RidgetopOta", code: 7, userInfo: [NSLocalizedDescriptionKey: "Truncated ZIP entry payload"])
            }

            let outData: Data
            if method == 0 {
                guard compSize == uncompSize else {
                    throw NSError(domain: "RidgetopOta", code: 8, userInfo: [NSLocalizedDescriptionKey: "Stored entry size mismatch"])
                }
                outData = Data(bytes[dataStart..<dataEnd])
            } else if method == 8 {
                if uncompSize == 0 {
                    outData = Data()
                } else {
                    outData = try decodeRawDeflateStreaming(bytes: bytes, start: dataStart, compSize: compSize, expectedSize: uncompSize)
                }
            } else {
                throw NSError(domain: "RidgetopOta", code: 9, userInfo: [NSLocalizedDescriptionKey: "Unsupported ZIP compression method \\(method)"])
            }

            try FileManager.default.createDirectory(at: targetUrl.deletingLastPathComponent(), withIntermediateDirectories: true)
            try outData.write(to: targetUrl, options: .atomic)
        }
    }
}
`
}

const ANDROID_BUILD_GRADLE = `ext {
    junitVersion = project.hasProperty('junitVersion') ? rootProject.ext.junitVersion : '4.13.2'
    androidxAppCompatVersion = project.hasProperty('androidxAppCompatVersion') ? rootProject.ext.androidxAppCompatVersion : '1.7.0'
}

buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.13.0'
    }
}

apply plugin: 'com.android.library'

android {
    namespace "com.ridgetop.ota"
    compileSdk project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 36
    defaultConfig {
        minSdkVersion project.hasProperty('minSdkVersion') ? rootProject.ext.minSdkVersion : 24
        targetSdkVersion project.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 36
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_21
        targetCompatibility JavaVersion.VERSION_21
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    implementation project(':capacitor-android')
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
}
`

const ANDROID_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" />
`

function renderAndroidJavaPlugin(pinnedPublicKey: string, allowedHost: string, allowLocal: boolean): string {
  return `package com.ridgetop.ota;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "RidgetopOta")
public class RidgetopOtaPlugin extends Plugin {
    private static final String PINNED_PUBLIC_KEY_BASE64 = "${escapeNativeString(pinnedPublicKey)}";
    private static final String ALLOWED_HOST = "${escapeNativeString(allowedHost)}";
    private static final boolean ALLOW_LOCAL_CHANNEL = ${allowLocal ? 'true' : 'false'};
    private static final int MAX_ZIP_BYTES = 50 * 1024 * 1024;
    private static final int MAX_ENTRIES = 2000;
    private static final int MAX_FILE_BYTES = 20 * 1024 * 1024;
    private static final int MAX_TOTAL_EXTRACTED_BYTES = 100 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final byte[] ED25519_SPKI_PREFIX = new byte[] {
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
    };

    private static final String PREFS_NAME = "ridgetop_ota";
    private static final String KEY_NATIVE_BUILD = "nativeBuild";
    private static final String KEY_ACTIVE = "activeVersion";
    private static final String KEY_STAGED = "stagedVersion";
    private static final String KEY_LAST_GOOD = "lastGoodVersion";
    private static final String KEY_FAILED = "failedVersion";
    private static final String KEY_PENDING = "pending";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object stateLock = new Object();
    private volatile String servedOtaVersion = null;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private String getAppId() {
        return getContext().getPackageName();
    }

    private String getNativeVersion() {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            return info.versionName != null ? info.versionName : "1.0.0";
        } catch (Exception e) {
            return "1.0.0";
        }
    }

    private String getNativeBuild() {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            return String.valueOf(code);
        } catch (Exception e) {
            return "1";
        }
    }

    private String getNativeSignature() {
        return getNativeVersion() + "(" + getNativeBuild() + ")";
    }

    private File bundlesRoot() {
        return new File(getContext().getFilesDir(), "ridgetop-ota/bundles");
    }

    private static String sanitizeVersion(String version) {
        String cleaned = version.trim()
            .replaceAll("[^a-zA-Z0-9._+-]+", "-")
            .replaceAll("\\\\.{2,}", "-")
            .replaceAll("^[.-]+|[.-]+$", "");
        if (cleaned.length() > 128) cleaned = cleaned.substring(0, 128);
        return cleaned.isEmpty() ? "0.0.0" : cleaned;
    }

    private File bundleDir(String version) throws IOException {
        File root = bundlesRoot();
        File candidate = new File(root, sanitizeVersion(version));
        String rootCanon = root.getCanonicalPath();
        String parentCanon = candidate.getCanonicalFile().getParent();
        if (parentCanon == null || !parentCanon.equals(rootCanon)) {
            throw new IOException("Invalid OTA version path");
        }
        return candidate;
    }

    private boolean isValidBundle(String version) {
        if (version == null) return false;
        try {
            return new File(bundleDir(version), "index.html").isFile();
        } catch (IOException e) {
            return false;
        }
    }

    private static boolean isPrivateLanHost(String host) {
        String lower = host.toLowerCase(Locale.US);
        if ("localhost".equals(lower) || "127.0.0.1".equals(lower)) return true;
        String[] parts = lower.split("\\\\.");
        if (parts.length != 4) return false;
        int[] nums = new int[4];
        try {
            for (int i = 0; i < 4; i++) {
                nums[i] = Integer.parseInt(parts[i]);
                if (nums[i] < 0 || nums[i] > 255) return false;
            }
        } catch (NumberFormatException e) {
            return false;
        }
        if (nums[0] == 10) return true;
        if (nums[0] == 192 && nums[1] == 168) return true;
        return nums[0] == 172 && nums[1] >= 16 && nums[1] <= 31;
    }

    private static boolean isAllowedDownloadUrl(URL url, boolean allowLocalHttp) {
        String protocol = url.getProtocol();
        String host = url.getHost();
        if (protocol == null || host == null || host.isEmpty()) return false;
        String protoLower = protocol.toLowerCase(Locale.US);
        if ("https".equals(protoLower)) {
            if (!ALLOWED_HOST.isEmpty()) {
                return ALLOWED_HOST.equalsIgnoreCase(host);
            }
            return true;
        }
        return "http".equals(protoLower) && allowLocalHttp && isPrivateLanHost(host);
    }

    private boolean verifyManifestSignature(
        String channel,
        String version,
        String minNativeVersion,
        String sha256,
        String signatureBase64
    ) {
        if (PINNED_PUBLIC_KEY_BASE64.isEmpty()) return true;
        if ("local".equals(channel) && ALLOW_LOCAL_CHANNEL) return true;
        if (signatureBase64 == null || signatureBase64.isEmpty()) return false;
        try {
            byte[] rawPub = Base64.decode(PINNED_PUBLIC_KEY_BASE64, Base64.DEFAULT);
            byte[] sigBytes = Base64.decode(signatureBase64, Base64.DEFAULT);
            if (rawPub.length != 32 || sigBytes.length != 64) return false;
            byte[] spki = new byte[ED25519_SPKI_PREFIX.length + 32];
            System.arraycopy(ED25519_SPKI_PREFIX, 0, spki, 0, ED25519_SPKI_PREFIX.length);
            System.arraycopy(rawPub, 0, spki, ED25519_SPKI_PREFIX.length, 32);
            PublicKey pubKey = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(spki));
            String canonical = "ridgetop-ota-v1\\n" + getAppId() + "\\n" + channel + "\\n"
                + version + "\\n" + minNativeVersion + "\\n" + sha256.toLowerCase(Locale.US);
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(pubKey);
            verifier.update(canonical.getBytes(StandardCharsets.UTF_8));
            return verifier.verify(sigBytes);
        } catch (Exception e) {
            return false;
        }
    }

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursive(child);
            }
        }
        file.delete();
    }

    private void clearAllOtaState() {
        servedOtaVersion = null;
        prefs().edit().clear().commit();
        deleteRecursive(bundlesRoot());
    }

    private void runOnActivityUiThread(Runnable action) {
        Activity act = getActivity();
        if (act != null) act.runOnUiThread(action);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    @Override
    public void load() {
        final String pathToLoad;
        final String versionToLoad;
        synchronized (stateLock) {
            SharedPreferences sp = prefs();
            String sig = getNativeSignature();
            if (!sig.equals(sp.getString(KEY_NATIVE_BUILD, null))) {
                clearAllOtaState();
                sp.edit().putString(KEY_NATIVE_BUILD, sig).commit();
                return;
            }

            if (sp.getBoolean(KEY_PENDING, false)) {
                String bad = sp.getString(KEY_ACTIVE, null);
                SharedPreferences.Editor ed = sp.edit();
                if (bad != null) {
                    ed.putString(KEY_FAILED, bad);
                    try { deleteRecursive(bundleDir(bad)); } catch (IOException ignored) {}
                }
                String lastGood = sp.getString(KEY_LAST_GOOD, null);
                if (isValidBundle(lastGood)) {
                    ed.putString(KEY_ACTIVE, lastGood);
                } else {
                    ed.remove(KEY_ACTIVE);
                }
                ed.putBoolean(KEY_PENDING, false).commit();
            }

            String staged = sp.getString(KEY_STAGED, null);
            if (isValidBundle(staged)) {
                sp.edit()
                    .putString(KEY_ACTIVE, staged)
                    .remove(KEY_STAGED)
                    .putBoolean(KEY_PENDING, true)
                    .commit();
            }

            String active = sp.getString(KEY_ACTIVE, null);
            if (isValidBundle(active)) {
                String resolvedPath = null;
                try {
                    resolvedPath = bundleDir(active).getAbsolutePath();
                } catch (IOException ignored) {
                    resolvedPath = null;
                }
                pathToLoad = resolvedPath;
                versionToLoad = resolvedPath != null ? active : null;
            } else {
                pathToLoad = null;
                versionToLoad = null;
            }
        }
        if (pathToLoad != null && versionToLoad != null) {
            runOnActivityUiThread(() -> {
                Bridge bridge = getBridge();
                if (bridge != null) {
                    servedOtaVersion = versionToLoad;
                    bridge.setServerBasePath(pathToLoad);
                }
            });
        }
    }

    @PluginMethod
    public void downloadAndStage(PluginCall call) {
        String urlStr = call.getString("url");
        String version = call.getString("version");
        String expectedSha = call.getString("sha256");
        String channel = call.getString("channel", "prod");
        String minNativeVersion = call.getString("minNativeVersion", "0.0.0");
        String signature = call.getString("signature");

        if (urlStr == null || version == null || expectedSha == null || version.isEmpty() || expectedSha.length() != 64) {
            call.reject("Missing or invalid parameters: url, version, sha256");
            return;
        }
        final boolean allowLocalHttp = "local".equals(channel) && ALLOW_LOCAL_CHANNEL;
        final String expectedLower = expectedSha.toLowerCase(Locale.US);

        if (!verifyManifestSignature(channel, version, minNativeVersion, expectedLower, signature)) {
            call.reject("Invalid or missing OTA manifest signature");
            return;
        }

        executor.execute(() -> {
            File tempZip = null;
            File tempDir = new File(bundlesRoot(), ".tmp-" + UUID.randomUUID());
            try {
                if (!bundlesRoot().exists()) bundlesRoot().mkdirs();
                tempZip = new File(bundlesRoot(), ".tmp-dl-" + UUID.randomUUID() + ".zip");
                String actualSha = downloadToFileAndHash(urlStr, tempZip, allowLocalHttp);
                if (!actualSha.equals(expectedLower)) {
                    call.reject("OTA bundle integrity check failed");
                    return;
                }
                if (!tempDir.mkdirs() && !tempDir.isDirectory()) {
                    throw new IOException("Could not create staging directory");
                }
                extractZip(tempZip, tempDir);
                if (!new File(tempDir, "index.html").isFile()) {
                    deleteRecursive(tempDir);
                    call.reject("OTA bundle missing index.html");
                    return;
                }
                synchronized (stateLock) {
                    String active = prefs().getString(KEY_ACTIVE, null);
                    if (active != null && sanitizeVersion(active).equals(sanitizeVersion(version))) {
                        deleteRecursive(tempDir);
                        call.reject("Cannot overwrite currently active OTA bundle");
                        return;
                    }
                    File targetDir = bundleDir(version);
                    deleteRecursive(targetDir);
                    if (!tempDir.renameTo(targetDir)) {
                        deleteRecursive(tempDir);
                        call.reject("Could not finalize staged bundle");
                        return;
                    }
                    prefs().edit().putString(KEY_STAGED, version).commit();
                }
                JSObject ret = new JSObject();
                ret.put("version", version);
                ret.put("staged", true);
                call.resolve(ret);
            } catch (Exception e) {
                deleteRecursive(tempDir);
                call.reject("OTA download failed: " + e.getMessage());
            } finally {
                if (tempZip != null) tempZip.delete();
            }
        });
    }

    @PluginMethod
    public void apply(PluginCall call) {
        boolean shouldReload = Boolean.TRUE.equals(call.getBoolean("reload", true));
        final String staged;
        final String path;
        synchronized (stateLock) {
            SharedPreferences sp = prefs();
            staged = sp.getString(KEY_STAGED, null);
            JSObject ret = new JSObject();
            if (!isValidBundle(staged)) {
                ret.put("applied", false);
                ret.put("version", JSObject.NULL);
                call.resolve(ret);
                return;
            }
            if (!shouldReload) {
                // Leave in KEY_STAGED so load() promotes and marks pending on the next launch.
                ret.put("applied", true);
                ret.put("version", staged);
                call.resolve(ret);
                return;
            }
            String resolvedPath;
            try {
                resolvedPath = bundleDir(staged).getAbsolutePath();
            } catch (IOException e) {
                ret.put("applied", false);
                ret.put("version", JSObject.NULL);
                call.resolve(ret);
                return;
            }
            sp.edit()
                .putString(KEY_ACTIVE, staged)
                .remove(KEY_STAGED)
                .putBoolean(KEY_PENDING, true)
                .commit();
            path = resolvedPath;
        }
        runOnActivityUiThread(() -> {
            Bridge bridge = getBridge();
            if (bridge != null) {
                servedOtaVersion = staged;
                bridge.setServerBasePath(path);
            }
        });
        JSObject ret = new JSObject();
        ret.put("applied", true);
        ret.put("version", staged);
        call.resolve(ret);
    }

    @PluginMethod
    public void confirmReady(PluginCall call) {
        String expectedVersion = call.getString("version");
        JSObject ret = new JSObject();
        synchronized (stateLock) {
            SharedPreferences sp = prefs();
            String active = sp.getString(KEY_ACTIVE, null);
            if (active != null) {
                if (!active.equals(servedOtaVersion)) {
                    ret.put("confirmed", false);
                    ret.put("version", JSObject.NULL);
                    call.resolve(ret);
                    return;
                }
                if (expectedVersion != null && !expectedVersion.isEmpty() && !expectedVersion.equals(active)) {
                    ret.put("confirmed", false);
                    ret.put("version", JSObject.NULL);
                    call.resolve(ret);
                    return;
                }
                sp.edit()
                    .putBoolean(KEY_PENDING, false)
                    .putString(KEY_LAST_GOOD, active)
                    .commit();
                Set<String> keep = new HashSet<>();
                keep.add(sanitizeVersion(active));
                String staged = sp.getString(KEY_STAGED, null);
                if (staged != null) keep.add(sanitizeVersion(staged));
                pruneOldBundles(keep);
                ret.put("confirmed", true);
                ret.put("version", active);
            } else {
                sp.edit().putBoolean(KEY_PENDING, false).commit();
                ret.put("confirmed", true);
                ret.put("version", JSObject.NULL);
            }
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void reset(PluginCall call) {
        synchronized (stateLock) {
            clearAllOtaState();
            prefs().edit().putString(KEY_NATIVE_BUILD, getNativeSignature()).commit();
        }
        runOnActivityUiThread(() -> {
            Bridge bridge = getBridge();
            if (bridge != null) bridge.setServerAssetPath("public");
        });
        JSObject ret = new JSObject();
        ret.put("reset", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        synchronized (stateLock) {
            SharedPreferences sp = prefs();
            String active = sp.getString(KEY_ACTIVE, null);
            String staged = sp.getString(KEY_STAGED, null);
            String lastGood = sp.getString(KEY_LAST_GOOD, null);
            String failed = sp.getString(KEY_FAILED, null);
            ret.put("appId", getAppId());
            ret.put("nativeVersion", getNativeVersion());
            ret.put("nativeBuild", getNativeBuild());
            ret.put("activeVersion", active != null ? active : JSObject.NULL);
            ret.put("stagedVersion", staged != null ? staged : JSObject.NULL);
            ret.put("lastGoodVersion", lastGood != null ? lastGood : JSObject.NULL);
            ret.put("failedVersion", failed != null ? failed : JSObject.NULL);
            ret.put("isOtaActive", isValidBundle(active));
            ret.put("signatureRequired", !PINNED_PUBLIC_KEY_BASE64.isEmpty());
        }
        call.resolve(ret);
    }

    private void pruneOldBundles(Set<String> keepDirNames) {
        File[] children = bundlesRoot().listFiles();
        if (children == null) return;
        for (File child : children) {
            String name = child.getName();
            if (name.startsWith(".tmp-") || keepDirNames.contains(name)) continue;
            deleteRecursive(child);
        }
    }

    private static String downloadToFileAndHash(String urlStr, File destFile, boolean allowLocalHttp) throws Exception {
        URL current = URI.create(urlStr).toURL();
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            if (!isAllowedDownloadUrl(current, allowLocalHttp)) {
                throw new IOException("Disallowed OTA download URL");
            }
            HttpURLConnection conn = (HttpURLConnection) current.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setUseCaches(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            try {
                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.isEmpty()) {
                        throw new IOException("Redirect missing Location");
                    }
                    current = current.toURI().resolve(location).toURL();
                    continue;
                }
                if (code < 200 || code >= 300) {
                    throw new IOException("HTTP " + code);
                }
                long contentLength = conn.getContentLengthLong();
                if (contentLength > MAX_ZIP_BYTES) {
                    throw new IOException("OTA bundle exceeds max allowed size");
                }
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                int total = 0;
                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(destFile)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        total += n;
                        if (total > MAX_ZIP_BYTES) {
                            throw new IOException("OTA bundle exceeds max allowed size");
                        }
                        md.update(buf, 0, n);
                        out.write(buf, 0, n);
                    }
                }
                if (total == 0) {
                    throw new IOException("Empty OTA bundle response");
                }
                byte[] digest = md.digest();
                StringBuilder sb = new StringBuilder(digest.length * 2);
                for (byte b : digest) {
                    sb.append(String.format(Locale.US, "%02x", b & 0xff));
                }
                return sb.toString();
            } finally {
                conn.disconnect();
            }
        }
        throw new IOException("Too many redirects");
    }

    private static void extractZip(File zipFile, File destDir) throws IOException {
        String destCanonical = destDir.getCanonicalPath() + File.separator;
        int entryCount = 0;
        long totalExtracted = 0;
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buf = new byte[16384];
            while ((entry = zis.getNextEntry()) != null) {
                entryCount++;
                if (entryCount > MAX_ENTRIES) {
                    throw new IOException("ZIP exceeds max entry count");
                }
                if (entry.isDirectory()) continue;
                File outFile = new File(destDir, entry.getName());
                String outCanonical = outFile.getCanonicalPath();
                if (!outCanonical.startsWith(destCanonical)) {
                    throw new IOException("Blocked zip-slip entry");
                }
                File parent = outFile.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs() && !parent.isDirectory()) {
                    throw new IOException("Could not create parent directory");
                }
                long fileBytes = 0;
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    int n;
                    while ((n = zis.read(buf)) != -1) {
                        fileBytes += n;
                        totalExtracted += n;
                        if (fileBytes > MAX_FILE_BYTES) {
                            throw new IOException("ZIP entry exceeds max file size");
                        }
                        if (totalExtracted > MAX_TOTAL_EXTRACTED_BYTES) {
                            throw new IOException("ZIP exceeds max total extracted size");
                        }
                        fos.write(buf, 0, n);
                    }
                }
            }
        }
    }
}
`
}

/** Emit the self-contained local Capacitor 8 OTA plugin (`ridgetop-ota/`) inside a mobile shell directory. */
export async function emitOtaCapacitorPlugin(pluginDir: string, options: EmitOtaPluginOptions = {}): Promise<void> {
  const esmDir = join(pluginDir, 'dist', 'esm')
  const iosSrcDir = join(pluginDir, 'ios', 'Sources', 'RidgetopOtaPlugin')
  const androidSrcDir = join(pluginDir, 'android', 'src', 'main', 'java', 'com', 'ridgetop', 'ota')
  const pinnedPublicKey = (options.publicKeyBase64 ?? '').trim()
  const allowedHost = (options.allowedHost ?? '').trim()
  const allowLocal = Boolean(options.allowLocal)

  await mkdir(esmDir, { recursive: true })
  await mkdir(iosSrcDir, { recursive: true })
  await mkdir(androidSrcDir, { recursive: true })

  await Promise.all([
    writeFile(join(pluginDir, 'package.json'), PLUGIN_PACKAGE_JSON),
    writeFile(join(esmDir, 'index.js'), PLUGIN_ESM_JS),
    writeFile(join(esmDir, 'index.d.ts'), PLUGIN_DTS),
    writeFile(join(pluginDir, 'dist', 'plugin.cjs.js'), PLUGIN_CJS_JS),
    writeFile(join(pluginDir, 'Package.swift'), PACKAGE_SWIFT),
    writeFile(join(pluginDir, 'RidgetopOta.podspec'), PODSPEC),
    writeFile(join(iosSrcDir, 'RidgetopOtaPlugin.swift'), renderIosSwiftPlugin(pinnedPublicKey, allowedHost, allowLocal)),
    writeFile(join(pluginDir, 'android', 'build.gradle'), ANDROID_BUILD_GRADLE),
    writeFile(join(pluginDir, 'android', 'src', 'main', 'AndroidManifest.xml'), ANDROID_MANIFEST),
    writeFile(join(androidSrcDir, 'RidgetopOtaPlugin.java'), renderAndroidJavaPlugin(pinnedPublicKey, allowedHost, allowLocal))
  ])
}
