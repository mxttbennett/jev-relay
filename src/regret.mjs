const CORRECTION =
  /^\s*(no\b|nope|wrong|incorrect|that('s| is)? (not|wrong)|not (what|right|quite)|still (broken|failing|wrong|not)|try again|redo|you (missed|forgot|broke|didn'?t)|didn'?t work|doesn'?t work|that failed)/i;

export const isCorrection = (prompt) => CORRECTION.test(prompt ?? "");
