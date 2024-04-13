import xss from 'xss';

export function validateInput(input: string): string {
  // 对用户输入进行 HTML 转义
  const filterInput = xss(input);
  return filterInput;
}