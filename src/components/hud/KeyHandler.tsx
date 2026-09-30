'use client';
/**
 * The one global key handler. Resolves keydown events with matchBinding() over KEY_BINDINGS (the
 * same list the help overlay renders) and ignores text fields, IME composition and auto-repeat.
 * Owner: design-system-hud.
 */
import { useEffect } from 'react';
import { matchBinding } from '@/lib/keyboard';
import { isTextField, runKeyAction } from './actions';

export function handleKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  // Inside a modal (palette, help, Style Studio) the dialog owns the keyboard, including Escape
  // (Radix closes it and restores focus), so global shortcuts pause.
  const t = e.target as Element | null;
  if (t && typeof t.closest === 'function' && t.closest('[aria-modal="true"]')) return;
  const action = matchBinding(e, isTextField(e.target));
  if (!action) return;
  e.preventDefault();
  runKeyAction(action);
}

export default function KeyHandler() {
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  return null;
}
