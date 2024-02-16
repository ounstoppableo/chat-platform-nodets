export function validateString(input: string): boolean {
  const punctuationRegex = /[!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~]/;
  return punctuationRegex.test(input);
}
  