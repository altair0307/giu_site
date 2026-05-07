type SearchableGame = {
  players: string | null;
  bestPlayers: string | null;
  playTime: string | null;
  genre: string | null;
  weight: string | null;
};

export type GameDetailFilters = {
  playerCount?: string;
  bestPlayerCount?: string;
  playTime?: string;
  genre?: string;
  weight?: string;
};

function normalizedText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function firstNumber(value: string | null | undefined) {
  const match = normalizedText(value).match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function numericRange(value: string | null | undefined) {
  const numbers = [...normalizedText(value).matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

  if (numbers.length === 0) {
    return null;
  }

  if (numbers.length === 1) {
    return { min: numbers[0], max: numbers[0] };
  }

  return {
    min: Math.min(numbers[0], numbers[1]),
    max: Math.max(numbers[0], numbers[1])
  };
}

function rangeContains(value: string | null | undefined, target: string | undefined) {
  const number = firstNumber(target);

  if (number === null) {
    return true;
  }

  const range = numericRange(value);

  if (!range) {
    return false;
  }

  return range.min <= number && number <= range.max;
}

function includesText(value: string | null | undefined, target: string | undefined) {
  const query = normalizedText(target);
  return !query || normalizedText(value).includes(query);
}

export function matchesGameDetailFilters(game: SearchableGame, filters: GameDetailFilters) {
  return (
    rangeContains(game.players, filters.playerCount) &&
    rangeContains(game.bestPlayers, filters.bestPlayerCount) &&
    rangeContains(game.playTime, filters.playTime) &&
    includesText(game.genre, filters.genre) &&
    includesText(game.weight, filters.weight)
  );
}

export function hasGameDetailFilters(filters: GameDetailFilters) {
  return Object.values(filters).some((value) => normalizedText(value).length > 0);
}
