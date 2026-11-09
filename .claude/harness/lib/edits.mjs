// Helpers to reason about file-editing tool calls (Write, Edit, MultiEdit, NotebookEdit).
import path from 'node:path';
import { readText } from './util.mjs';

export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export function editTarget(toolName, toolInput = {}) {
  if (toolName === 'NotebookEdit') return toolInput.notebook_path ?? null;
  return toolInput.file_path ?? null;
}

function applyEdit(text, oldStr, newStr, replaceAll) {
  if (oldStr === undefined || oldStr === null) return text;
  if (oldStr === '') return text === '' ? newStr ?? '' : text;
  if (replaceAll) return text.split(oldStr).join(newStr ?? '');
  const idx = text.indexOf(oldStr);
  if (idx < 0) return text;
  return text.slice(0, idx) + (newStr ?? '') + text.slice(idx + oldStr.length);
}

// Full file content after the edit is applied (best effort).
export function projectedContent(root, toolName, toolInput = {}) {
  const target = editTarget(toolName, toolInput);
  if (!target) return null;
  const abs = path.isAbsolute(target) ? target : path.join(root, target);
  if (toolName === 'Write') return toolInput.content ?? '';
  const current = readText(abs, '');
  if (toolName === 'Edit') return applyEdit(current, toolInput.old_string, toolInput.new_string, toolInput.replace_all);
  if (toolName === 'MultiEdit') {
    return (toolInput.edits ?? []).reduce((acc, e) => applyEdit(acc, e.old_string, e.new_string, e.replace_all), current);
  }
  return null;
}

// Only the text this call introduces (used for secret scanning to avoid blaming old content).
export function introducedText(toolName, toolInput = {}) {
  if (toolName === 'Write') return toolInput.content ?? '';
  if (toolName === 'Edit') return toolInput.new_string ?? '';
  if (toolName === 'MultiEdit') return (toolInput.edits ?? []).map((e) => e.new_string ?? '').join('\n');
  if (toolName === 'NotebookEdit') return toolInput.new_source ?? '';
  return '';
}

export function currentContent(root, toolName, toolInput = {}) {
  const target = editTarget(toolName, toolInput);
  if (!target) return null;
  const abs = path.isAbsolute(target) ? target : path.join(root, target);
  return readText(abs, null);
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|sql|css|scss)$/;
const CODE_ROOTS = /^(src|supabase\/migrations|supabase\/functions|supabase\/tests|tests|e2e)\//;

export function isCodePath(rel) {
  return Boolean(rel) && CODE_ROOTS.test(rel) && CODE_EXT.test(rel);
}
