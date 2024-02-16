import { escape } from 'he'; // 使用 he 库进行 HTML 转义

export function validateInput(input: string): string {
  // 对用户输入进行 HTML 转义
  const escapedInput = escape(input);
  return escapedInput;
}