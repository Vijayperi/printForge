/**
 * Prohibited / higher-risk content lists for prompt moderation (PRD §14).
 * OWNER DECISION REQUIRED: these are representative starter lists. The owner
 * must define the full prohibited-design categories (weapons/weapon components,
 * regulated items, illegal goods, hateful material, known third-party IP) and,
 * for higher-risk cases, a manual-review routing policy before launch.
 *
 * All terms are lowercase and matched whole-word (see WordlistModerator).
 */

// Hard-blocked terms → the request is refused (verdict "deny").
export const denyTerms: string[] = [
  // OWNER DECISION REQUIRED: weapons / weapon components
  "gun",
  "shotgun",
  "firearm",
  "rifle",
  "pistol",
  "revolver",
  "silencer",
  "suppressor",
  "ammunition",
  "grenade",
  "explosive",
  "bomb",
  // OWNER DECISION REQUIRED: regulated / illegal goods
  "cocaine",
  "methamphetamine",
]

// Ambiguous / higher-risk terms → allowed but routed to manual review (verdict "flag").
export const flagTerms: string[] = [
  // OWNER DECISION REQUIRED: could be benign (kitchen/tool) or not
  "knife",
  "blade",
  "dagger",
  // OWNER DECISION REQUIRED: possible third-party IP infringement
  "trademark",
  "logo",
  "brand",
  "replica",
]

// Human-readable summary of the categories the lists intend to cover.
export const moderationCategories =
  "weapons and weapon components, regulated or illegal goods, hateful material, and known third-party intellectual property"
