export const numberFormatter = new Intl.NumberFormat(undefined);

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes}\u00A0B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}\u00A0KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}\u00A0MB`;
};

export const formatDate = (value: string | null) => {
  if (!value) return "\u2014";
  return dateFormatter.format(new Date(value));
};

const TITLE_CASE_LOWERCASE_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "nor",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "with",
]);

export const formatDisplayTitle = (value: string) => {
  if (!value) return value;
  const tokens = value.split(/(\s+|[\-\u2013\u2014:])/u);
  let firstWordIndex = -1;
  let lastWordIndex = -1;
  const wordIndices: number[] = [];
  tokens.forEach((token, index) => {
    if (/^\s+$/.test(token) || /^[\-\u2013\u2014:]$/.test(token)) return;
    if (firstWordIndex === -1) firstWordIndex = index;
    lastWordIndex = index;
    wordIndices.push(index);
  });

  return tokens
    .map((token, index) => {
      if (!wordIndices.includes(index)) return token;
      const lower = token.toLocaleLowerCase();
      if (
        index !== firstWordIndex &&
        index !== lastWordIndex &&
        TITLE_CASE_LOWERCASE_WORDS.has(lower) &&
        token === token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
      ) {
        return lower;
      }
      return token;
    })
    .join("");
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

export const formatRelative = (value: string | null): string | null => {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  const week = day * 7;
  const month = day * 30;
  const year = day * 365;
  if (abs < minute) return "just now";
  if (abs < hour) return relativeTimeFormatter.format(Math.round(diff / minute), "minute");
  if (abs < day) return relativeTimeFormatter.format(Math.round(diff / hour), "hour");
  if (abs < week) return relativeTimeFormatter.format(Math.round(diff / day), "day");
  if (abs < month) return relativeTimeFormatter.format(Math.round(diff / week), "week");
  if (abs < year) return relativeTimeFormatter.format(Math.round(diff / month), "month");
  return relativeTimeFormatter.format(Math.round(diff / year), "year");
};
