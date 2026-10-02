'use client';
/**
 * Modal shell for the palette, help overlay and Style Studio: Radix Dialog (role=dialog,
 * aria-modal, focus trap, focus restore, Escape) on a glass-3 surface. Owner: design-system-hud.
 */
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

export default function ModalShell({
  title,
  description,
  onClose,
  children,
  className = '',
  overlay = true,
  hideTitle = false,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  overlay?: boolean;
  hideTitle?: boolean;
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        {overlay && <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-[rgba(0,0,0,0.45)]" />}
        <Dialog.Content aria-modal="true" className={`glass-3 fixed z-[var(--z-modal)] flex flex-col outline-none ${className}`}>
          <Dialog.Title className={hideTitle ? 'sr-only' : 'hud-title'}>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
