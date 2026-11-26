export * from './low-poly.ts'
export { fixedLoop, STEP } from './loop.ts'
export { connectRoom } from './room-client.ts'
export { createRng, nextRandom } from './rng.ts'
export { evaluateDecisions, verifyBounded, verifyTrace } from './verification.ts'
export { bindActionControls, bindPlatformControls, bindVirtualStick, readConnectedGamepads } from './input.ts'
export type { GamepadBinding, VirtualStickState } from './input.ts'
export { createGamePage } from './page.ts'
export { createPlatform, resolveStorage } from './platform.ts'
export type { LifecycleReason, PlatformKind, PlatformLifecycleHandlers, RidgetopNativeBridge, RidgetopPlatform } from './platform.ts'
export { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, createSaveBackup } from './backup.ts'
export type {
  SaveBackupEnvelope, SaveBackupInspectResult, SaveBackupManager, SaveBackupOptions,
  SaveBackupRestoreResult, SaveBackupStorage
} from './backup.ts'
export { createSoundscape, createSynthAudio } from './audio.ts'
export type { AudioBus, NoiseBedSpec } from './audio.ts'
export { createAudioBank, parseWav } from './audio-assets.ts'
export type { AudioBank, AudioBankOptions, AudioPlayHandle, AudioPlayOptions, ParsedWav } from './audio-assets.ts'
export { loadMesh, parseGlb, parseObj } from './import-mesh.ts'
export type { ImportedMeshPart } from './import-mesh.ts'
export { createSpriteAtlas, spriteColumn } from './sprites.ts'
export type { SpriteAtlasSource, SpriteClip, SpriteSheetImage } from './sprites.ts'
export { auditSpriteSheet, createSpriteSheet, hueShiftRamp, outlinePixelRegion, parseHexRgba } from './sprite-sheet.ts'
export type { HueRamp, SpriteAuditReport, SpriteFrame, SpriteOutlineMode, SpriteOutlineOptions } from './sprite-sheet.ts'
export { createPixelRig, pixelClips, renderPixelRig } from './pixel-rig.ts'
export type { PixelJoint, PixelJointPose, PixelRig, PixelStampSpec, WorldPixelJoint } from './pixel-rig.ts'
export {
  archMesh, bakeVertexAO, bakeZoneColors, bevelBox, capsuleMesh, chamferedPrism, crescentMesh,
  extrudeMesh, gableMesh, intersectRayPlane, invertMatrix, mergeMeshes, normalTiltQuaternion,
  projectPoint, quaternionFromEuler, revolvedMesh, rotateVec3, scallopedCone, screenToRay,
  sculptLoft, smoothMesh, tubeMesh, wedgeMesh, worldToScreen
} from './geometry.ts'
export type {
  MergeMeshInput, SculptLoftOptions, SculptLoftParamRing, SculptLoftPolygonRing, SculptLoftRing
} from './geometry.ts'
export { blendPoses, createAnimator, createMeshPool, createParticles, createRig, mirrorClip, multiplyQuat, renderRig, retimeClip, sampleClip } from './animation.ts'
export type { AnimationClip, Easing, JointPose, Keyframe, MeshPool, Rig, RigJoint, RigPart, WorldJoint } from './animation.ts'
export {
  CHARACTER_JOINT_PIVOTS, CHARACTER_SOCKETS, createCharacterBuilder, createCharacterPalette,
  DEFAULT_CHARACTER_PALETTE, mixColor, renderCharacterTurntablePixels, shadeColor
} from './character-builder.ts'
export type {
  CharacterBodyFactory, CharacterBuilder, CharacterJointId, CharacterPalette, CharacterPaletteRole,
  CharacterPartFactory, CharacterSocket, CharacterSocketInfo, CharacterSpec, CharacterTurntableOptions
} from './character-builder.ts'
export { createPlatformer } from './platformer.ts'
export type * from './types.ts'
export { angleDelta, createArcadeDriver, createCircuit } from './vehicle.ts'
export type { DriveInput, VehicleBody, TrackPoint } from './vehicle.ts'
export { createHud, createHudPainter } from './hud.ts'
export type { HudPainter } from './hud.ts'
export { createPerfLogger, createPerfMonitor } from './perf.ts'
export type { PerfLogEntry, PerfLogger, PerfLoggerOptions, PerfMonitor, PerfSnapshot } from './perf.ts'
export {
  artModels, artPalette, artShapes, bakeAnimatedSpriteDirections, bakeAnimatedSpritePixels, createArtKit,
  createArtRecipe, modelFromArtRecipe, recipeFromArtModel, rigFromArtModel, rigFromArtRecipe
} from './art.ts'
export type {
  AnimatedSpriteOptions, ArtBounds, ArtModel, ArtPart, ArtRecipe, ArtRecipeClip, ArtRecipeClipFrame,
  ArtRecipeJoint, ArtRecipeJointPose, ArtRecipePart, ArtRig, ArtShape, ArtTone, ArtTubeSpec,
  BakedSpriteManifest, BakedSpritePixels, BakedSpriteSheet, SpriteDirection
} from './art.ts'
export { artBases, artPartBounds, artPoseBounds, createArtBuilder, fitArtRecipe } from './art-builder.ts'
export type { ArtBase, ArtBuilderOptions, ArtFace, ArtPartStyle } from './art-builder.ts'
export { auditArtModel } from './art-review.ts'
export type { ArtAuditReport } from './art-review.ts'
export * from './physics3d.ts'
export {
  isTestingActive, isTestingPaused, onTestingPause, registerHudRegion, registerTestingHooks,
  setTestingActive, setTestingPaused
} from './testing-runtime.ts'
export type {
  ArtSourceInfo, CapturedFrame, HudRegion, Picked3DInstance, RecognizedAsset, RecognizedMember,
  SpriteAtlasMeta, SpriteDrawRecord, TestingHooks
} from './testing-runtime.ts'
