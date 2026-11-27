import type {
  DecisionAgentAdapter,
  DecisionAgentEvidence,
  DecisionAgentObservation,
  DecisionAgentOption
} from 'ridgetop/testing'
import type { AutoBattleActionPlan } from './simulation.ts'
import {
  cancelAutoBattle,
  collectAutoBattleCandidates,
  executeAutoBattlePlan,
  getUnitByUid
} from './simulation.ts'
import { isUnitDowned } from './types.ts'
import type { GameState } from './types.ts'

export interface CrownshardDecisionAgentHost {
  readonly state: GameState
  readonly getScreen?: () => string
  readonly enterBattle: () => void
  readonly confirmDeployment: () => boolean
  readonly dismissOverlays?: () => void
  readonly onActed: () => void
}

function shortActionLabel(plan: AutoBattleActionPlan): string {
  switch (plan.kind) {
    case 'tactic': return 'Play Tactic Card'
    case 'skill': return 'Cast Skill'
    case 'move_and_skill': return 'Move & Cast Skill'
    case 'attack': return 'Strike Enemy'
    case 'move_and_attack': return 'Move & Strike'
    case 'move': return 'Reposition'
    case 'end_turn': return 'End Turn'
  }
}

/**
 * Create a Ridgetop Decision Agent adapter for Crownshard tactical battles.
 * Exposes legal tactical candidates, structured battlefield state, and evidence signals
 * so any Decision API provider (Typesafe JEV, Cloudflare Clef, OpenAI, or Local)
 * can visibly play Crownshard turns with live probability inspection.
 */
export function createCrownshardDecisionAgent(host: CrownshardDecisionAgentHost): DecisionAgentAdapter {
  let latestPlans = new Map<string, AutoBattleActionPlan>()

  return {
    name: 'Crownshard Tactical Agent',
    description: 'Turn-based grid tactics powered by the Ridgetop Decision API',
    stepIntervalMs: 850,
    ensurePlayable() {
      const battle = host.state.battle
      const screen = host.getScreen?.()
      if (!battle || battle.phase === 'victory' || battle.phase === 'defeat' || (screen && screen !== 'battle')) {
        host.enterBattle()
        if (host.state.battle?.phase === 'deploy') {
          host.confirmDeployment()
        }
        host.dismissOverlays?.()
        host.onActed()
        return
      }
      if (battle.phase === 'deploy') {
        host.confirmDeployment()
      }
      host.dismissOverlays?.()
      host.onActed()
    },
    observe(): DecisionAgentObservation {
      const battle = host.state.battle
      const screen = host.getScreen?.()
      if (!battle || (screen && screen !== 'battle')) {
        return {
          ready: false,
          status: screen ? `On ${screen} screen` : 'Not in battle',
          summary: 'Click "▶ Auto-Play", "Step Once", or "Enter Gameplay" to start a campaign battle.',
          rubric: '',
          state: null,
          options: [],
          evidence: []
        }
      }
      if (battle.phase === 'victory' || battle.phase === 'defeat') {
        return {
          ready: false,
          status: battle.phase === 'victory' ? 'Battle Won!' : 'Battle Defeated',
          summary: `Battle ended (${battle.phase}) on Turn ${battle.turn}. Click "Enter Gameplay" to start a fresh battle.`,
          rubric: '',
          state: { phase: battle.phase, turn: battle.turn },
          options: [],
          evidence: []
        }
      }
      if (battle.phase === 'deploy') {
        latestPlans = new Map()
        return {
          ready: true,
          status: 'Deployment phase',
          summary: `Ready to deploy squad for ${battle.objective.label}`,
          rubric: 'Confirm squad deployment to begin the tactical battle.',
          state: { phase: 'deploy', objective: battle.objective.label },
          options: [
            { id: 'confirm_deploy', label: 'Confirm Deployment', description: 'Begin battle with current hero formation', heuristicScore: 100 }
          ],
          evidence: [{ id: 'deployment_ready', label: 'Squad Ready', value: true }]
        }
      }
      if (battle.phase !== 'player' || battle.units.some(u => u.path.length > 0)) {
        return {
          ready: false,
          status: battle.phase === 'enemy' ? 'Enemy turn…' : 'Animating move…',
          summary: `Turn ${battle.turn} · Waiting for active player hero`,
          rubric: '',
          state: null,
          options: [],
          evidence: []
        }
      }

      const actor = getUnitByUid(battle, battle.activeUnitUid)
      if (!actor || !actor.alive || actor.team !== 'ally') {
        return {
          ready: false,
          status: 'Advancing turn…',
          summary: `Turn ${battle.turn}`,
          rubric: '',
          state: null,
          options: [],
          evidence: []
        }
      }

      const candidates = collectAutoBattleCandidates(host.state, 6)
      latestPlans = new Map()
      const options: DecisionAgentOption[] = candidates.map((plan, index) => {
        const id = `opt_${index}_${plan.kind}`
        latestPlans.set(id, plan)
        return {
          id,
          label: `${shortActionLabel(plan)} — ${plan.reason}`,
          description: plan.reason,
          category: plan.kind,
          heuristicScore: Math.round(plan.score)
        }
      })

      const allies = battle.units.filter(u => u.alive && u.team === 'ally')
      const downedAllies = battle.units.filter(u => isUnitDowned(u) && u.team === 'ally')
      const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
      const currentCell = battle.cells[actor.row]?.[actor.col]
      const standingInHazard = Boolean(currentCell && currentCell.terrain === 'lava_geyser' && currentCell.geyserActive)
      const heroLowHp = actor.hp <= actor.maxHp * 0.45
      const allyInjured = downedAllies.length > 0 || allies.some(a => a.hp <= a.maxHp * 0.6)
      const enemyLowHp = enemies.some(e => e.hp <= e.maxHp * 0.45)
      const canAttackNow = candidates.some(c => c.kind === 'attack' || c.kind === 'move_and_attack' || c.kind === 'skill' || c.kind === 'move_and_skill')
      const hasTactic = candidates.some(c => c.kind === 'tactic')

      const evidence: DecisionAgentEvidence[] = [
        { id: 'can_attack_now', label: 'Can Strike/Cast Now', value: canAttackNow },
        { id: 'enemy_low_hp', label: 'Weakened Enemy (<45% HP)', value: enemyLowHp },
        { id: 'hero_low_hp', label: 'Active Hero Low HP', value: heroLowHp },
        { id: 'ally_injured', label: 'Ally Needs Heal/Revive', value: allyInjured },
        { id: 'standing_in_hazard', label: 'Standing in Lava Hazard', value: standingInHazard },
        ...(hasTactic ? [{ id: 'tactic_ready', label: 'Tactic Card Ready', value: true }] : [])
      ]

      return {
        ready: options.length > 0,
        status: `${actor.name}'s turn`,
        summary: `Turn ${battle.turn} · ${actor.name} (${actor.hp}/${actor.maxHp} HP) · ${enemies.length} enemies left · ${battle.objective.label}`,
        rubric: 'Choose the best tactical action for the active hero in Crownshard. Prioritize eliminating weakened enemies, healing/reviving endangered allies, escaping active hazards, and advancing toward the objective.',
        state: {
          turn: battle.turn,
          ap: battle.ap,
          objective: battle.objective.label,
          activeHero: {
            name: actor.name,
            hp: actor.hp,
            maxHp: actor.maxHp,
            shield: actor.shield,
            pos: [actor.col, actor.row],
            moved: actor.moved,
            acted: actor.acted
          },
          allies: allies.map(a => ({ name: a.name, hp: a.hp, maxHp: a.maxHp, pos: [a.col, a.row] })),
          enemies: enemies.slice(0, 6).map(e => ({ name: e.name, hp: e.hp, maxHp: e.maxHp, pos: [e.col, e.row] }))
        },
        options,
        evidence
      }
    },
    act(optionId: string): boolean {
      if (host.state.battle?.autoBattle) {
        cancelAutoBattle(host.state)
      }
      if (optionId === 'confirm_deploy') {
        const ok = host.confirmDeployment()
        host.onActed()
        return ok
      }
      const plan = latestPlans.get(optionId)
      if (!plan) return false
      const ok = executeAutoBattlePlan(host.state, plan)
      host.onActed()
      return ok
    }
  }
}
