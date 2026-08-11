/**
 * api/rarityStatsAPI.js — PUBLIC bridge client. Copied to unified-modules; NOT imported by
 * this addon's runtime. Consumers:
 *     import * as rrsAPI from "unified/rarityStats/rarityStatsAPI.js"
 * Registration data crosses as JSON; passive *behavior* stays here and runs on a trigger callback.
 */
//version 2.0 *
import { system, world } from '@minecraft/server';

const handlers = new Map(); // callbackId → your passive's behavior (never crosses the wire)
const gates = new Map(); // callbackId → { test, charge } for custom reroll cost gates

function send(kind, data) {
    system.sendScriptEvent('rrs:register', JSON.stringify({ kind, data }));
}

// Bridge verification: resolves true if Rarity & Stats is installed and answering, else false.
// Call it before registering so the dependency stays optional.
export function ping(timeoutTicks = 20) {
    return new Promise((resolve) => {
        let settled = false;
        function onPong(event) {
            if (event.id !== 'rrs:pong') return;
            settled = true;
            system.afterEvents.scriptEventReceive.unsubscribe(onPong);
            resolve(true);
        }
        system.afterEvents.scriptEventReceive.subscribe(onPong);
        system.sendScriptEvent('rrs:ping', '');
        system.runTimeout(() => {
            if (settled) return;
            system.afterEvents.scriptEventReceive.unsubscribe(onPong);
            resolve(false);
        }, timeoutTicks);
    });
}

export function registerMaterial(material) {
    send('material', material);
}

export function registerItemType(type, match) {
    send('itemType', { type, match });
}

export function setRarityConfig(tier) {
    send('rarity', tier);
}

export function registerRerollCost(rarityId, cost) {
    send('rerollCost', { rarityId, cost });
}

export function registerAscendCost(rarityId, cost) {
    send('ascendCost', { rarityId, cost });
}
//version 2.4 *
// Per-passive survival-craft cost, keyed by ITEM rarity — presence makes a passive craftable in /rrs:craft.
// costByRarity = { <rarityId>: { xpLevels, xpLevelsWithItems?, items? } }.
//   rrsAPI.registerCraftCost('myPassive', { common: { xpLevels: 10 }, rare: { xpLevels: 20, xpLevelsWithItems: 8, items: [['minecraft:iron_ingot', 3]] } })
export function registerCraftCost(passiveId, costByRarity) {
    send('craftCost', { passiveId, cost: costByRarity });
}
//version 2.4 *
// Retune op curves / costs without forking. patch = { <table>: { <rarityId>: value | partialRow | null } }
// tables: ascendChance · upgradeRisk · ascendCost · upgradeCost. null removes, object merges, else replaces.
//   rrsAPI.setConfig({ ascendChance: { 6: 0.5 }, upgradeRisk: { 7: { step: 0.05, cap: 0.3 } } })
export function setConfig(patch) {
    send('config', patch);
}
// Custom reroll cost gate. Your test/charge run synchronously HERE (your runtime); R&S asks over RPC
// when it needs them, so the function never crosses the wire — only the callback id is registered.
//   test(player, ctx)   → bool : can this player afford / are they allowed?
//   charge(player, ctx) → bool : verify + deduct atomically, return whether it succeeded
export function registerRerollHandler(id, test, charge) {
    gates.set(id, { test, charge });
    send('rerollHandler', { callbackId: id });
}

export function registerPassive(passive) {
    const { id, handler, ...meta } = passive;
    if (handler) handlers.set(id, handler);          // keep behavior local
    send('passive', { id, callbackId: id, ...meta }); // send metadata + the callback id only
}

// Public stat-system enums (mirror configs/config.js — keep in sync; this file is standalone for consumers).
export const ATTRIBUTES = {
    MaxHealth: 'minecraft:health',
    Movement: 'minecraft:movement',
    AttackDamage: 'minecraft:attack_damage', // flat +x, any weapon class
    KnockbackResistance: 'minecraft:knockback_resistance',
    AttackDamagePercent: 'rrs:attack_damage_percent', // +x% of (base + flat bonuses)
    MeleeDamage: 'rrs:melee_damage', // flat +x, melee hits only
    RangedDamage: 'rrs:ranged_damage', // flat +x, ranged (projectile) hits only
    CriticalChance: 'rrs:critical_chance', // % chance a hit crits (0..100)
    CriticalDamage: 'rrs:critical_damage', // +x% on top of the base crit multiplier
};
export const ATTRIBUTE_SLOTS = {
    Armor: ['Head', 'Chest', 'Legs', 'Feet'],
    Mainhand: ['Mainhand'],
    Offhand: ['Offhand'],
    Hands: ['Mainhand', 'Offhand'],
    All: ['Head', 'Chest', 'Legs', 'Feet', 'Mainhand', 'Offhand'],
};

// Bind a registered STAT passive to an attribute + the slots it applies from. The core then stores its value
// per slot as `<statId>_<itemtype>`, so your stat never clobbers another addon's stat on the same attribute.
//   rrsAPI.registerStat('myStat', rrsAPI.ATTRIBUTES.MaxHealth, rrsAPI.ATTRIBUTE_SLOTS.Armor)
export function registerStat(statId, attribute, slots) {
    send('stat', { statId, attribute, slots });
}

// Cooldown counters (helpers only) — track locally in YOUR runtime (no bridge round-trip; your trigger
// handler already runs here). Build the counterId with cdKey so the CD-notification UI can parse it back:
//   const key = rrsAPI.cdKey('myPassive', { slot: ctx.slot });
//   if (rrsAPI.isOnCooldown(ctx.entityId, key)) return;  … ; rrsAPI.startCooldown(ctx.entityId, key, 40)
// Convention (LOCKED): `<passiveId>[:<facet>][#<slot>]` — `:` and `#` never appear in a passive id.
export function cdKey(passiveId, { facet, slot } = {}) {
    return passiveId + (facet ? `:${facet}` : '') + (slot ? `#${slot}` : '');
}
const cooldowns = new Map(); // entityId → Map<counterId, expiryTick>
export function startCooldown(entityId, counterId, ticks) {
    let m = cooldowns.get(entityId);
    if (!m) cooldowns.set(entityId, (m = new Map()));
    m.set(counterId, system.currentTick + Math.max(0, ticks | 0));
}
export function getCooldown(entityId, counterId) {
    const exp = cooldowns.get(entityId)?.get(counterId);
    return exp ? Math.max(0, exp - system.currentTick) : 0;
}
export function isOnCooldown(entityId, counterId) {
    return getCooldown(entityId, counterId) > 0;
}

// Trigger loop: core fires rrs:trigger back → run your handler by its id. `source` = the event that
// fired (one of your passive's triggerOnEvents), so one handler can branch per event.
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== 'rrs:trigger') return;

    const { callbackId, source, ctx } = JSON.parse(event.message);
    const handler = handlers.get(callbackId);
    if (handler) handler(source, ctx);                // ← calling the function by its string id
});

// RPC responder: R&S asks "can they afford?" / "charge them" for a gate we own → reply with the result.
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== 'rrs:req') return;

    const { nonce, method, callbackId, data } = JSON.parse(event.message);
    const gate = gates.get(callbackId);
    if (!gate) return; // not ours — another addon's gate

    const fn = method === 'gateCharge' ? gate.charge : gate.test;
    const player = world.getEntity(data.playerId);
    const ok = !!fn?.(player, data.ctx);             // runs sync in our own runtime
    system.sendScriptEvent('rrs:res', JSON.stringify({ nonce, ok }));
});
//version 2.0 *
