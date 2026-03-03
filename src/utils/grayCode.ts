export function grayCode(n: number): number[] {
  if (n <= 0) return [0];
  const res: number[] = [0];
  for (let i = 0; i < n; i++) {
    const prefix = 1 << i;
    for (let j = res.length - 1; j >= 0; j--) {
      res.push(res[j] | prefix);
    }
  }
  return res;
}

export function grayCodeBinaryStrings(n: number): string[] {
  return grayCode(n).map((v) => v.toString(2).padStart(n, "0"));
}

// Example: grayCodeBinaryStrings(3) -> ["000","001","011","010","110","111","101","100"]
