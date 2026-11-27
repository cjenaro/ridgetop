import { createCharacterBuilder } from 'ridgetop'
import type { CharacterSpec, Rig } from 'ridgetop'
import type { EnemyArchetypeId, HeroClassId } from './types.ts'
import { registerCrownshardBodiesAndHair } from './parts/bodies-hair.ts'
import { registerCrownshardHeadgear } from './parts/headgear.ts'
import { registerCrownshardArmor } from './parts/armor.ts'
import { registerCrownshardWeapons } from './parts/weapons.ts'

export const crownshardCharacterBuilder = createCharacterBuilder()
registerCrownshardBodiesAndHair(crownshardCharacterBuilder)
registerCrownshardHeadgear(crownshardCharacterBuilder)
registerCrownshardArmor(crownshardCharacterBuilder)
registerCrownshardWeapons(crownshardCharacterBuilder)

export const HERO_CHARACTER_SPECS: Readonly<Record<HeroClassId, CharacterSpec>> = {
  knight: {
    body: 'humanoid',
    palette: {
      skin: '#f2c6a0',
      hair: '#693f28',
      primary: '#2d66ba',
      secondary: '#d44242',
      metal: '#c0cfd9',
      metalDark: '#47596e',
      leather: '#6b4228',
      accent: '#eab746',
      glow: '#70f2ff'
    },
    parts: {
      headgear: 'helm_knight_visored',
      chest: 'chest_plate',
      pauldrons: 'pauldrons_knight',
      belt: 'belt_hex_plate',
      skirt: 'skirt_tassets',
      back: 'cape_royal',
      bracerL: 'bracer_plate',
      bracerR: 'bracer_plate',
      bootL: 'boot_cuff_plate',
      bootR: 'boot_cuff_plate',
      mainHand: 'weapon_broadsword',
      offHand: 'shield_heater'
    }
  },
  archer: {
    body: 'humanoid_slim',
    palette: {
      skin: '#f5ccb0',
      hair: '#874b2a',
      primary: '#2f7f58',
      secondary: '#9e683b',
      metal: '#b5c2cc',
      leather: '#6e4527',
      leatherLight: '#a66f42',
      accent: '#f0be4d',
      glow: '#ffea8a'
    },
    parts: {
      ears: 'elf_pointed',
      brows: 'brows_arched',
      headgear: 'hood_ranger',
      chest: 'chest_ranger_vest',
      pauldrons: 'pauldrons_ranger',
      collar: 'collar_scarf',
      belt: 'belt_ranger_pouches',
      skirt: 'skirt_ranger_tunic',
      back: 'quiver_arrows',
      bracerL: 'bracer_leather',
      bracerR: 'bracer_leather',
      bootL: 'boot_cuff_fur',
      bootR: 'boot_cuff_fur',
      mainHand: 'weapon_arrow_nocked',
      offHand: 'offhand_bow_recurve'
    }
  },
  mage: {
    body: 'humanoid',
    palette: {
      skin: '#f0c4a2',
      hair: '#dde6f0',
      primary: '#43358a',
      secondary: '#6252b8',
      metal: '#d9b252',
      leather: '#5c3c28',
      accent: '#f5ca56',
      glow: '#70f2ff'
    },
    parts: {
      brows: 'brows_noble',
      hair: 'hair_mage_long',
      beard: 'beard_sage',
      headgear: 'hat_wizard',
      chest: 'chest_arcane_robe',
      pauldrons: 'pauldrons_arcane',
      belt: 'belt_arcane_sash',
      skirt: 'skirt_robe_hem',
      back: 'cape_royal',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      mainHand: 'weapon_staff_arcane',
      offHand: 'offhand_spell_orb'
    }
  },
  cleric: {
    body: 'humanoid_slim',
    palette: {
      skin: '#f5cbb0',
      hair: '#e5b84e',
      primary: '#ebe3cf',
      secondary: '#d9a43d',
      metal: '#f0c859',
      leather: '#7a5233',
      accent: '#f5cf5e',
      glow: '#fff2a6'
    },
    parts: {
      brows: 'brows_arched',
      hair: 'hair_noble_bob',
      headgear: 'hood_cleric_veil',
      chest: 'chest_cleric_vestment',
      pauldrons: 'pauldrons_paladin',
      belt: 'belt_arcane_sash',
      skirt: 'skirt_robe_hem',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      bootL: 'boot_cuff_gold',
      bootR: 'boot_cuff_gold',
      mainHand: 'weapon_mace_sun',
      offHand: 'offhand_tome'
    }
  },
  rogue: {
    body: 'humanoid_slim',
    palette: {
      skin: '#ebc09e',
      hair: '#2c3244',
      primary: '#3c4560',
      secondary: '#c93c46',
      metal: '#8596a8',
      leather: '#3c2e2c',
      accent: '#d9454f',
      glow: '#ff7070'
    },
    parts: {
      brows: 'brows_fierce',
      face: 'face_mask_rogue',
      headgear: 'cowl_rogue',
      chest: 'chest_rogue_leathers',
      collar: 'collar_scarf',
      belt: 'belt_ranger_pouches',
      skirt: 'skirt_ranger_tunic',
      back: 'cape_tattered',
      bracerL: 'bracer_leather',
      bracerR: 'bracer_leather',
      mainHand: 'weapon_dagger',
      offHand: 'offhand_dagger'
    }
  },
  paladin: {
    body: 'humanoid_broad',
    palette: {
      skin: '#f0c4a0',
      hair: '#d9ad4a',
      primary: '#ede6d3',
      secondary: '#2f65b5',
      metal: '#dce3eb',
      metalDark: '#7c8fa3',
      leather: '#6b472b',
      accent: '#f5c74c',
      glow: '#fff09c'
    },
    parts: {
      headgear: 'helm_paladin_winged',
      chest: 'chest_plate',
      pauldrons: 'pauldrons_paladin',
      collar: 'collar_gold_mantle',
      belt: 'belt_hex_plate',
      skirt: 'skirt_tassets',
      back: 'cape_royal',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      bootL: 'boot_cuff_gold',
      bootR: 'boot_cuff_gold',
      mainHand: 'weapon_sunblade',
      offHand: 'shield_tower_paladin'
    }
  },
  cryomancer: {
    body: 'humanoid_slim',
    palette: {
      skin: '#f2d0be',
      hair: '#cbeeff',
      primary: '#2c5c94',
      secondary: '#4b93c9',
      metal: '#c8e4f5',
      leather: '#3d4c63',
      accent: '#9ee6ff',
      glow: '#88f4ff'
    },
    parts: {
      brows: 'brows_arched',
      hair: 'hair_mage_long',
      headgear: 'hat_cryo_tiara',
      chest: 'chest_arcane_robe',
      collar: 'collar_fur',
      pauldrons: 'pauldrons_arcane',
      belt: 'belt_arcane_sash',
      skirt: 'skirt_robe_hem',
      back: 'cape_royal',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      bootL: 'boot_cuff_fur',
      bootR: 'boot_cuff_fur',
      mainHand: 'weapon_staff_frost',
      offHand: 'offhand_spell_orb'
    }
  },
  champion: {
    body: 'humanoid_broad',
    palette: {
      skin: '#efc09b',
      hair: '#c97b32',
      primary: '#b82e35',
      secondary: '#eab746',
      metal: '#f0c756',
      metalDark: '#8c6626',
      leather: '#5c3322',
      accent: '#ffe382',
      glow: '#ffba42'
    },
    parts: {
      brows: 'brows_fierce',
      hair: 'hair_champion_mane',
      beard: 'beard_braided',
      headgear: 'helm_champion_crown',
      chest: 'chest_plate',
      pauldrons: 'pauldrons_gilded',
      collar: 'collar_gold_mantle',
      belt: 'belt_hex_plate',
      skirt: 'skirt_tassets',
      back: 'cape_royal',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      bootL: 'boot_cuff_gold',
      bootR: 'boot_cuff_gold',
      mainHand: 'weapon_sunblade',
      offHand: 'shield_tower_paladin'
    }
  }
}

export const ENEMY_CHARACTER_SPECS: Readonly<Record<EnemyArchetypeId, CharacterSpec>> = {
  goblin: {
    body: 'goblin',
    palette: {
      skin: '#6e9e4c',
      primary: '#63462c',
      secondary: '#8f3932',
      metal: '#7c8791',
      leather: '#593b25',
      accent: '#c98f3a',
      glow: '#ff9b30'
    },
    parts: {
      ears: 'goblin_long',
      headgear: 'helm_goblin_scrap',
      belt: 'belt_ranger_pouches',
      mainHand: 'weapon_goblin_cleaver',
      offHand: 'shield_buckler'
    }
  },
  bone_archer: {
    body: 'skeleton',
    palette: {
      skin: '#e0d8c5',
      primary: '#4a3f68',
      secondary: '#6b3e82',
      metal: '#8d99a6',
      leather: '#4d3a2c',
      accent: '#9a78bf',
      glow: '#a86bff'
    },
    parts: {
      headgear: 'helm_bone_hood',
      back: 'quiver_arrows',
      mainHand: 'weapon_arrow_nocked',
      offHand: 'offhand_bow_recurve'
    }
  },
  orc_brute: {
    body: 'orc_brute',
    palette: {
      skin: '#527d48',
      primary: '#593628',
      secondary: '#9e2e2e',
      metal: '#6f7c87',
      metalDark: '#3f4954',
      leather: '#543521',
      accent: '#b87f3d',
      glow: '#ff5c38'
    },
    parts: {
      pauldrons: 'pauldrons_spiked',
      collar: 'collar_fur',
      belt: 'belt_hex_plate',
      bracerL: 'bracer_plate',
      bracerR: 'bracer_plate',
      mainHand: 'weapon_greataxe'
    }
  },
  bog_shaman: {
    body: 'goblin',
    palette: {
      skin: '#6a9a5c',
      primary: '#54417a',
      secondary: '#4d8759',
      metal: '#857d94',
      leather: '#4a3829',
      accent: '#c25eff',
      glow: '#c85eff'
    },
    parts: {
      ears: 'goblin_long',
      headgear: 'helm_bone_hood',
      chest: 'chest_arcane_robe',
      skirt: 'skirt_robe_hem',
      back: 'cape_tattered',
      mainHand: 'weapon_scythe_bone',
      offHand: 'offhand_spell_orb'
    }
  },
  crypt_knight: {
    body: 'skeleton',
    palette: {
      skin: '#e3dccb',
      primary: '#8a2636',
      secondary: '#c23a48',
      metal: '#8d97ad',
      metalDark: '#3f465c',
      leather: '#4a3438',
      accent: '#c9cfdc',
      glow: '#ff4a3d'
    },
    parts: {
      headgear: 'helm_dark_lord',
      chest: 'chest_obsidian_plate',
      pauldrons: 'pauldrons_spiked',
      belt: 'belt_hex_plate',
      skirt: 'skirt_tassets',
      back: 'cape_tattered',
      bracerL: 'bracer_plate',
      bracerR: 'bracer_plate',
      bootL: 'boot_greave_plate',
      bootR: 'boot_greave_plate',
      mainHand: 'weapon_obsidian_greatsword',
      offHand: 'shield_obsidian'
    }
  },
  frost_golem: {
    body: 'frost_golem',
    palette: {
      skin: '#6a8fb4',
      primary: '#6890ba',
      secondary: '#8fdfff',
      metal: '#b0e2fa',
      metalDark: '#6687aa',
      accent: '#c9f3ff',
      glow: '#7cf0ff'
    },
    parts: {
      headgear: 'hat_cryo_tiara',
      bracerL: 'bracer_plate',
      bracerR: 'bracer_plate'
    }
  },
  eclipse_archon: {
    // Final boss: lilac-steel mask-helm under a gold crown of shadow shards + floating eclipse halo,
    // rising crescent pauldrons, floor-length royal mantle and a glowing eclipse scepter.
    body: 'humanoid_broad',
    palette: {
      skin: '#8a7fae',
      primary: '#5a3290',
      primaryDark: '#3a2160',
      secondary: '#b8336a',
      metal: '#a49cc8',
      metalDark: '#4a3d70',
      leather: '#3e2c4f',
      accent: '#f4c24e',
      glow: '#e872ff'
    },
    parts: {
      headgear: 'crown_eclipse',
      chest: 'chest_obsidian_plate',
      pauldrons: 'pauldrons_eclipse',
      collar: 'collar_gold_mantle',
      belt: 'belt_hex_plate',
      skirt: 'skirt_robe_hem',
      back: 'mantle_eclipse',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      bootL: 'boot_greave_plate',
      bootR: 'boot_greave_plate',
      mainHand: 'weapon_eclipse_scepter',
      offHand: 'offhand_spell_orb'
    }
  },
  ember_pyromancer: {
    body: 'humanoid_slim',
    palette: {
      skin: '#d99a74',
      hair: '#3a1a18',
      primary: '#8c231c',
      primaryDark: '#4d1414',
      secondary: '#e8611e',
      metal: '#c48342',
      metalDark: '#5c3320',
      leather: '#4a261b',
      accent: '#ffb845',
      glow: '#ff7b24'
    },
    parts: {
      brows: 'brows_fierce',
      face: 'face_mask_rogue',
      headgear: 'hat_wizard',
      chest: 'chest_arcane_robe',
      pauldrons: 'pauldrons_arcane',
      collar: 'collar_gold_mantle',
      belt: 'belt_arcane_sash',
      skirt: 'skirt_robe_hem',
      back: 'cape_tattered',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      mainHand: 'weapon_ember_scepter',
      offHand: 'offhand_spell_orb'
    }
  },
  ice_wraith: {
    body: 'skeleton',
    palette: {
      skin: '#d4f4ff',
      primary: '#1f5e8c',
      primaryDark: '#123859',
      secondary: '#62c8f5',
      metal: '#bae9ff',
      metalDark: '#3f6e94',
      leather: '#284a68',
      accent: '#b8f3ff',
      glow: '#7cf4ff'
    },
    parts: {
      headgear: 'helm_bone_hood',
      chest: 'chest_arcane_robe',
      pauldrons: 'pauldrons_frostguard',
      collar: 'collar_frostguard',
      skirt: 'skirt_robe_hem',
      back: 'cape_windrunner',
      mainHand: 'weapon_frostbite_staff',
      offHand: 'offhand_spell_orb'
    }
  },
  bone_necromancer: {
    body: 'skeleton',
    palette: {
      skin: '#e8e0cc',
      primary: '#362259',
      primaryDark: '#201338',
      secondary: '#48b878',
      metal: '#a29db8',
      metalDark: '#423a59',
      leather: '#382a45',
      accent: '#5ce89a',
      glow: '#48ff9c'
    },
    parts: {
      headgear: 'helm_bone_hood',
      chest: 'chest_arcane_robe',
      pauldrons: 'pauldrons_spiked',
      collar: 'collar_blood_amulet',
      belt: 'belt_arcane_sash',
      skirt: 'skirt_robe_hem',
      back: 'cape_tattered',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      mainHand: 'weapon_scythe_bone',
      offHand: 'offhand_tome'
    }
  },
  bone_thrall: {
    body: 'skeleton',
    palette: {
      skin: '#d9d0bc',
      primary: '#3f524c',
      primaryDark: '#263631',
      secondary: '#52b884',
      metal: '#7c858f',
      metalDark: '#474f59',
      leather: '#4a3d2e',
      accent: '#8da398',
      glow: '#62ffa8'
    },
    parts: {
      headgear: 'helm_goblin_scrap',
      belt: 'belt_ranger_pouches',
      mainHand: 'weapon_goblin_cleaver',
      offHand: 'shield_buckler'
    }
  },
  river_troll: {
    body: 'orc_brute',
    palette: {
      skin: '#3d7c6e',
      primary: '#2c544b',
      primaryDark: '#1b3832',
      secondary: '#62a856',
      metal: '#6e8c82',
      metalDark: '#39524b',
      leather: '#5c4630',
      accent: '#7cd96e',
      glow: '#b4ff4a'
    },
    parts: {
      face: 'face_warpaint',
      collar: 'collar_fur',
      pauldrons: 'pauldrons_brigandine',
      belt: 'belt_hex_plate',
      bracerL: 'bracer_leather',
      bracerR: 'bracer_leather',
      bootL: 'boot_cuff_fur',
      bootR: 'boot_cuff_fur',
      mainHand: 'weapon_greataxe',
      offHand: 'shield_buckler'
    }
  },
  briar_warlord: {
    body: 'orc_brute',
    palette: {
      skin: '#466e3a',
      primary: '#7a2c24',
      primaryDark: '#471916',
      secondary: '#c98832',
      metal: '#b89458',
      metalDark: '#524432',
      leather: '#4d311c',
      accent: '#f0b848',
      glow: '#ff7038'
    },
    parts: {
      headgear: 'helm_dark_lord',
      face: 'face_scar',
      chest: 'chest_plate',
      pauldrons: 'pauldrons_spiked',
      collar: 'collar_fur',
      belt: 'belt_hex_plate',
      skirt: 'skirt_tassets',
      back: 'cape_tattered',
      bracerL: 'bracer_plate',
      bracerR: 'bracer_plate',
      bootL: 'boot_greave_plate',
      bootR: 'boot_greave_plate',
      mainHand: 'weapon_greataxe',
      offHand: 'shield_obsidian'
    }
  },
  mire_matriarch: {
    body: 'humanoid_slim',
    palette: {
      skin: '#95b89e',
      hair: '#2b4736',
      primary: '#2c5c46',
      primaryDark: '#1b3b2d',
      secondary: '#8f3eb8',
      metal: '#8ea882',
      metalDark: '#3b4f3d',
      leather: '#3e3326',
      accent: '#6aff7e',
      glow: '#88ff4d'
    },
    parts: {
      ears: 'elf_pointed',
      brows: 'brows_fierce',
      headgear: 'hat_wizard',
      chest: 'chest_arcane_robe',
      pauldrons: 'pauldrons_windrunner',
      collar: 'collar_windrunner',
      belt: 'belt_arcane_sash',
      skirt: 'skirt_robe_hem',
      back: 'cape_windrunner',
      bracerL: 'bracer_copper_signet',
      bracerR: 'bracer_copper_signet',
      mainHand: 'weapon_scythe_bone',
      offHand: 'offhand_spell_orb'
    }
  },
  ash_inquisitor: {
    body: 'skeleton',
    palette: {
      skin: '#ece5d4',
      primary: '#471f66',
      primaryDark: '#2a1240',
      secondary: '#a82c5e',
      metal: '#c4b8db',
      metalDark: '#4a3d66',
      leather: '#3c2547',
      accent: '#f2c15a',
      glow: '#4dffb8'
    },
    parts: {
      headgear: 'crown_eclipse',
      chest: 'chest_arcane_robe',
      pauldrons: 'pauldrons_eclipse',
      collar: 'collar_blood_amulet',
      belt: 'belt_arcane_sash',
      skirt: 'skirt_robe_hem',
      back: 'mantle_eclipse',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      mainHand: 'weapon_eclipse_scepter',
      offHand: 'offhand_tome'
    }
  },
  frost_jarl: {
    body: 'humanoid_broad',
    palette: {
      skin: '#cfe2f0',
      hair: '#dff4ff',
      primary: '#1e4878',
      primaryDark: '#122c4d',
      secondary: '#62b8e8',
      metal: '#c6e8fa',
      metalDark: '#4b6e8c',
      leather: '#344759',
      accent: '#9cf0ff',
      glow: '#78f4ff'
    },
    parts: {
      brows: 'brows_fierce',
      beard: 'beard_braided',
      headgear: 'helm_paladin_winged',
      chest: 'chest_frostguard',
      pauldrons: 'pauldrons_frostguard',
      collar: 'collar_frostguard',
      belt: 'belt_hex_plate',
      skirt: 'skirt_tassets',
      back: 'cape_royal',
      bracerL: 'bracer_plate',
      bracerR: 'bracer_plate',
      bootL: 'boot_cuff_fur',
      bootR: 'boot_cuff_fur',
      mainHand: 'weapon_dragonfang_halberd',
      offHand: 'shield_heater'
    }
  },
  magma_warden: {
    body: 'frost_golem',
    palette: {
      skin: '#4a2824',
      primary: '#a6341c',
      primaryDark: '#361b19',
      secondary: '#ff7828',
      metal: '#ff9642',
      metalDark: '#3d3033',
      leather: '#45241c',
      accent: '#ffd259',
      glow: '#ff5e1a'
    },
    parts: {
      headgear: 'helm_dark_lord',
      pauldrons: 'pauldrons_spiked',
      bracerL: 'bracer_plate',
      bracerR: 'bracer_plate',
      mainHand: 'weapon_obsidian_greatsword'
    }
  },
  dune_sovereign_boss: {
    // Tier VI Sunbleached Dunes Raid Boss: gilded pharaoh-construct in sun-gold plate & lapis mantle
    body: 'humanoid_broad',
    palette: {
      skin: '#c9a66b',
      primary: '#c98e2b',
      primaryDark: '#7a5216',
      secondary: '#1e788a',
      metal: '#f7d265',
      metalDark: '#78531b',
      leather: '#5c3c1e',
      accent: '#ffe88a',
      glow: '#ffba38'
    },
    parts: {
      headgear: 'helm_champion_crown',
      chest: 'chest_aegis_dawn',
      pauldrons: 'pauldrons_gilded',
      collar: 'collar_gold_mantle',
      belt: 'belt_heart_of_solis',
      skirt: 'skirt_tassets',
      back: 'mantle_eclipse',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      bootL: 'boot_cuff_gold',
      bootR: 'boot_cuff_gold',
      mainHand: 'weapon_sunblade',
      offHand: 'shield_aegis_dawn'
    }
  },
  astral_warden_boss: {
    // Tier VII Aether Isles Raid Boss: radiant winged sentinel of alabaster marble & lightning cyan-gold
    body: 'humanoid_broad',
    palette: {
      skin: '#e8f4ff',
      primary: '#dce8f7',
      primaryDark: '#5b7aa8',
      secondary: '#2b8cd9',
      metal: '#f2f7ff',
      metalDark: '#4e6f9c',
      leather: '#3b4e6e',
      accent: '#ffe16e',
      glow: '#6ef4ff'
    },
    parts: {
      headgear: 'helm_paladin_winged',
      chest: 'chest_frostguard',
      pauldrons: 'pauldrons_paladin',
      collar: 'collar_aegis_dawn',
      belt: 'belt_skyhawk_crest',
      skirt: 'skirt_tassets',
      back: 'halo_radiant',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      bootL: 'boot_gale_striders',
      bootR: 'boot_gale_striders',
      mainHand: 'weapon_dragonfang_halberd',
      offHand: 'offhand_spell_orb'
    }
  },
  unbroken_crown_boss: {
    // Tier VIII Shattered Expanse Apex Raid Boss: primordial solar-eclipse sovereign with radiant halo & crown
    body: 'humanoid_broad',
    palette: {
      skin: '#261c3a',
      primary: '#301d52',
      primaryDark: '#190f2e',
      secondary: '#e6a62e',
      metal: '#ffd866',
      metalDark: '#4e3973',
      leather: '#2b1b42',
      accent: '#fff0a6',
      glow: '#ffae38'
    },
    parts: {
      headgear: 'crown_eclipse',
      chest: 'chest_obsidian_plate',
      pauldrons: 'pauldrons_eclipse',
      collar: 'collar_heart_of_solis',
      belt: 'belt_heart_of_solis',
      skirt: 'skirt_robe_hem',
      back: 'halo_radiant',
      bracerL: 'bracer_gold',
      bracerR: 'bracer_gold',
      bootL: 'boot_greave_plate',
      bootR: 'boot_greave_plate',
      mainHand: 'weapon_eclipse_scepter',
      offHand: 'offhand_spell_orb'
    }
  }
}

export const HERO_RIGS: Record<HeroClassId, Rig> = {
  knight: crownshardCharacterBuilder.assemble(HERO_CHARACTER_SPECS.knight),
  archer: crownshardCharacterBuilder.assemble(HERO_CHARACTER_SPECS.archer),
  mage: crownshardCharacterBuilder.assemble(HERO_CHARACTER_SPECS.mage),
  cleric: crownshardCharacterBuilder.assemble(HERO_CHARACTER_SPECS.cleric),
  rogue: crownshardCharacterBuilder.assemble(HERO_CHARACTER_SPECS.rogue),
  paladin: crownshardCharacterBuilder.assemble(HERO_CHARACTER_SPECS.paladin),
  cryomancer: crownshardCharacterBuilder.assemble(HERO_CHARACTER_SPECS.cryomancer),
  champion: crownshardCharacterBuilder.assemble(HERO_CHARACTER_SPECS.champion)
}

export const ENEMY_RIGS: Record<EnemyArchetypeId, Rig> = {
  goblin: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.goblin),
  bone_archer: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.bone_archer),
  orc_brute: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.orc_brute),
  bog_shaman: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.bog_shaman),
  crypt_knight: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.crypt_knight),
  frost_golem: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.frost_golem),
  eclipse_archon: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.eclipse_archon),
  ember_pyromancer: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.ember_pyromancer),
  ice_wraith: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.ice_wraith),
  bone_necromancer: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.bone_necromancer),
  bone_thrall: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.bone_thrall),
  river_troll: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.river_troll),
  briar_warlord: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.briar_warlord),
  mire_matriarch: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.mire_matriarch),
  ash_inquisitor: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.ash_inquisitor),
  frost_jarl: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.frost_jarl),
  magma_warden: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.magma_warden),
  dune_sovereign_boss: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.dune_sovereign_boss),
  astral_warden_boss: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.astral_warden_boss),
  unbroken_crown_boss: crownshardCharacterBuilder.assemble(ENEMY_CHARACTER_SPECS.unbroken_crown_boss)
}

const customHeroRigCache = new Map<string, Rig>()

export interface HeroVisualLoadout {
  readonly stars?: 1 | 2 | 3
  readonly weaponId?: string
  readonly armorId?: string
  readonly relicId?: string
}

/**
 * Resolve the complete CharacterSpec for a hero given their star ascension tier and equipped gear.
 * Precedence: Base class -> Star ascension (2★/3★) -> Armor -> Relic -> Weapon (+ off-hand conflict cleanup).
 * Applying star upgrades BEFORE equipment ensures equipped gear is never clobbered by 2★/3★ upgrades.
 */
export function resolveHeroCharacterSpec(heroId: HeroClassId, loadout?: HeroVisualLoadout): CharacterSpec {
  const stars = loadout?.stars ?? 1
  const weaponId = loadout?.weaponId ?? ''
  const armorId = loadout?.armorId ?? ''
  const relicId = loadout?.relicId ?? ''

  const base = HERO_CHARACTER_SPECS[heroId]
  if (stars === 1 && !weaponId && !armorId && !relicId) return base

  const parts: Partial<NonNullable<CharacterSpec['parts']>> = { ...base.parts }
  const palette: Partial<NonNullable<CharacterSpec['palette']>> = { ...base.palette }

  // 1. Star Ascension upgrades FIRST (2★ gilded pauldrons/cuffs, 3★ radiant sun-halo)
  if (stars >= 2) {
    parts.pauldrons = 'pauldrons_gilded'
    parts.bootL = 'boot_cuff_gold'
    parts.bootR = 'boot_cuff_gold'
  }
  if (stars >= 3) {
    parts.back = 'halo_radiant'
  }

  // 2. Equipped Armor visual swaps (all 6 armor items have bespoke 3D parts)
  if (armorId === 'leather_jerkin') {
    parts.chest = 'chest_scout_brigandine'
    parts.pauldrons = 'pauldrons_brigandine'
  } else if (armorId === 'iron_plate') {
    parts.chest = 'chest_watchman_plate'
    parts.pauldrons = 'pauldrons_watchman'
  } else if (armorId === 'ranger_cloak') {
    parts.back = 'cape_windrunner'
    parts.collar = 'collar_windrunner'
    parts.pauldrons = 'pauldrons_windrunner'
  } else if (armorId === 'runed_mail') {
    parts.chest = 'chest_runed_mail'
    parts.pauldrons = 'pauldrons_runed_mail'
    palette.glow = '#6eb8ff'
  } else if (armorId === 'frostguard_plate') {
    parts.chest = 'chest_frostguard'
    parts.pauldrons = 'pauldrons_frostguard'
    parts.collar = 'collar_frostguard'
    palette.metal = '#bce4fa'
  } else if (armorId === 'aegis_of_dawn') {
    parts.chest = 'chest_aegis_dawn'
    parts.pauldrons = 'pauldrons_aegis_dawn'
    parts.collar = 'collar_aegis_dawn'
    if (
      parts.offHand === 'shield_heater' ||
      parts.offHand === 'shield_buckler' ||
      parts.offHand === 'shield_tower_paladin'
    ) {
      parts.offHand = 'shield_aegis_dawn'
    }
    palette.accent = '#ffe078'
  }

  // 3. Equipped Relic visual swaps (all 5 relic items have bespoke 3D parts)
  if (relicId === 'copper_signet') {
    parts.bracerL = 'bracer_copper_signet'
    parts.bracerR = 'bracer_copper_signet'
  } else if (relicId === 'swift_boots') {
    parts.bootL = 'boot_gale_striders'
    parts.bootR = 'boot_gale_striders'
  } else if (relicId === 'blood_amulet') {
    parts.collar = 'collar_blood_amulet'
  } else if (relicId === 'eagle_charm') {
    parts.belt = 'belt_skyhawk_crest'
    parts.bracerR = 'bracer_skyhawk'
  } else if (relicId === 'heart_of_solis') {
    parts.collar = 'collar_heart_of_solis'
    parts.belt = 'belt_heart_of_solis'
    palette.glow = '#ffdb6e'
  }

  // 4. Equipped Weapon visual swaps + off-hand conflict resolution (all 7 weapon items have bespoke 3D parts)
  const clearBowOffhand = () => {
    if (parts.offHand === 'offhand_bow_recurve' || parts.offHand === 'offhand_bow_yew') {
      delete parts.offHand
    }
  }
  const clearTwoHandConflicts = () => {
    clearBowOffhand()
    if (parts.offHand === 'offhand_dagger') {
      delete parts.offHand
    }
  }

  if (weaponId === 'iron_sword') {
    parts.mainHand = 'weapon_iron_broadsword'
    clearBowOffhand()
  } else if (weaponId === 'hunter_bow' || weaponId === 'yew_bow') {
    parts.mainHand = 'weapon_yew_arrow'
    parts.offHand = 'offhand_bow_yew'
  } else if (weaponId === 'ember_wand' || weaponId === 'apprentice_staff') {
    parts.mainHand = 'weapon_ember_scepter'
    clearTwoHandConflicts()
    palette.glow = '#ff8a3d'
  } else if (weaponId === 'sunsteel_blade') {
    parts.mainHand = 'weapon_sunsteel_blade'
    clearBowOffhand()
  } else if (weaponId === 'frostbite_staff') {
    parts.mainHand = 'weapon_frostbite_staff'
    clearTwoHandConflicts()
    palette.glow = '#88f4ff'
  } else if (weaponId === 'dragonfang_spear') {
    parts.mainHand = 'weapon_dragonfang_halberd'
    clearTwoHandConflicts()
    palette.glow = '#d66bff'
  } else if (weaponId === 'solis_crownblade') {
    parts.mainHand = 'weapon_solis_crownblade'
    clearTwoHandConflicts()
    palette.glow = '#ffe478'
  }

  return {
    body: base.body,
    palette,
    parts,
    scale: base.scale
  }
}

/**
 * Dynamically compose & cache a modular hero rig reflecting equipped Weapon/Armor/Relic cards
 * and 2★/3★ ascension upgrades without ever allocating per frame.
 */
export function resolveHeroRig(heroId: HeroClassId, loadout?: HeroVisualLoadout): Rig {
  const stars = loadout?.stars ?? 1
  const weaponId = loadout?.weaponId ?? ''
  const armorId = loadout?.armorId ?? ''
  const relicId = loadout?.relicId ?? ''
  if (stars === 1 && !weaponId && !armorId && !relicId) return HERO_RIGS[heroId]

  const key = `${heroId}:${stars}:${weaponId}:${armorId}:${relicId}`
  const cached = customHeroRigCache.get(key)
  if (cached) return cached

  const rig = crownshardCharacterBuilder.assemble(resolveHeroCharacterSpec(heroId, loadout))
  customHeroRigCache.set(key, rig)
  return rig
}
