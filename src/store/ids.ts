const ADJECTIVES = [
  "AMBER", "BLUE", "BRAVE", "BRIGHT", "CALM", "CLEVER", "COSMIC", "CRISP",
  "DAPPER", "EAGER", "FANCY", "GOLDEN", "HAPPY", "JOLLY", "LIVELY", "LUCKY",
  "MELLOW", "MERRY", "NIMBLE", "PLUM", "QUIET", "RAPID", "ROSY", "RUBY",
  "SILVER", "SNAPPY", "SUNNY", "SWIFT", "TIDY", "VIVID", "WARM", "ZESTY",
];

const NOUNS = [
  "BADGER", "CANYON", "COMET", "CORAL", "CRANE", "DOLPHIN", "EMBER", "FALCON",
  "FERN", "GROVE", "HARBOR", "HERON", "LANTERN", "MAPLE", "MEADOW", "ORCHID",
  "OTTER", "PANDA", "PEBBLE", "PIER", "QUILL", "RAVEN", "RIVER", "ROBIN",
  "SPARROW", "SUMMIT", "TIGER", "TULIP", "VALLEY", "WALRUS", "WILLOW", "ZEBRA",
];

export const EVENT_ID_PATTERN = /^[A-Z]+-[A-Z]+-\d{2}$/;

export function generateEventId(random: () => number = Math.random): string {
  const pick = (words: string[]): string => words[Math.floor(random() * words.length)]!;
  const number = 10 + Math.floor(random() * 90);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${number}`;
}

export function normalizeEventId(raw: string): string {
  return raw.trim().toUpperCase();
}
