// Copyright (c) 2026 Leonardo Boquillon <lboquillon at gmail dot com>
// Licensed under the MIT License. See LICENSE file for details.


const PII_PATTERNS = [
  { name: 'email',       re: /[\w.-]+@[\w.-]+\.\w+/g },
  { name: 'phone',       re: /\b\d{3}[-.]\d{3}[-.]\d{4}\b/g },
  { name: 'ssn',         re: /\b\d{3}-?\d{2}-?\d{4}\b/g },
  { name: 'credit_card', re: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },
  { name: 'api_key',     re: /\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36})\b/g },
  { name: 'aws_key',     re: /\b(AKIA[0-9A-Z]{16})\b/g },
  { name: 'ip_address',  re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
];

export function containsPII(text: string): boolean {
  for (const { re } of PII_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      re.lastIndex = 0;
      return true;
    }
  }
  return false;
}

export function redactPII(text: string): string {
  let result = text;
  for (const { name, re } of PII_PATTERNS) {
    re.lastIndex = 0;
    result = result.replace(re, `[REDACTED_${name.toUpperCase()}]`);
    re.lastIndex = 0;
  }
  return result;
}
