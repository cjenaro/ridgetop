import { createMeshPool, renderRig } from 'ridgetop'
import type { InstanceBatch, JointPose, Rig } from 'ridgetop'
import { defaultMenuLayout } from 'ridgetop/server'
import type { ResolvedGameAssets } from 'ridgetop/server'
import { ENEMY_RIGS, HERO_RIGS, buildCampDioramaBatches, stanceOffsetFor } from './art.ts'
import { SFX_MOTIFS } from './audio.ts'
import { COLOR } from './ui-art.ts'

/**
 * Assets consumed by `ridgetop package` (app icons, Godot GLB models, baked WAV motifs, UI theme).
 * Model keys use the game's own hero/enemy ids so engine ports can map `BattleUnit.heroId` /
 * `enemyId` straight to `assets/models/<id>.glb`, and audio keys match `SoundEvent.kind`
 * (`turn_ally`/`turn_enemy`, `pack`/`pack_rare` split by team/rarity).
 */
export function resolvePackageAssets(): ResolvedGameAssets {
  const bakeRig = (rig: Rig, pose: Readonly<Record<string, JointPose>> = {}, yaw = 0): InstanceBatch[] => {
    const pool = createMeshPool(32)
    renderRig(rig, { position: [0, 0, 0], yaw, scale: 1 }, pose, pool)
    return pool.batches.filter(b => b.count > 0)
  }

  const models: Record<string, readonly InstanceBatch[]> = { camp: buildCampDioramaBatches() }
  for (const [id, rig] of Object.entries(HERO_RIGS)) models[id] = bakeRig(rig)
  for (const [id, rig] of Object.entries(ENEMY_RIGS)) models[id] = bakeRig(rig)

  const audio: ResolvedGameAssets['audio'] = {}
  for (const [id, motif] of Object.entries(SFX_MOTIFS)) {
    audio[id] = { notes: motif.notes, waveform: motif.waveform }
  }

  return {
    title: 'Crownshard',
    // Combat-ready stance reads far better at launcher-icon size than the T-ish rest pose.
    icon: {
      batches: bakeRig(HERO_RIGS.knight, stanceOffsetFor('knight'), 0.5),
      span: 1.72,
      centerY: 0.92,
      background: '#0e1321',
      accent: COLOR.accent
    },
    models,
    audio,
    gameData: {
      game: 'crownshard',
      units: {
        heroes: Object.keys(HERO_RIGS),
        enemies: Object.keys(ENEMY_RIGS)
      },
      theme: {
        surface: COLOR.surface,
        surfaceAlt: COLOR.surfaceAlt,
        top: COLOR.top,
        border: COLOR.border,
        accent: COLOR.accent,
        accentText: COLOR.accentText,
        text: COLOR.text,
        muted: COLOR.muted,
        glow: COLOR.ap
      }
    },
    uiTree: defaultMenuLayout('Crownshard', ['Begin Campaign', 'Vanguard Camp', 'Quit'])
  }
}
