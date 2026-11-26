export const transitionLifetime = 20_000;

export interface Transition {
  id: string;
  course: string;
  chapter: string;
  expiresAt: number;
}

export type TransitionMessage =
  | { kind: 'expect-next'; transition: Transition }
  | { kind: 'take-next' }
  | { kind: 'cancel-next'; id: string };

export type TabMessage = { kind: 'get-muted' | 'toggle-muted' | 'next-background-step' };
export interface TabMutedUpdate {
  kind: 'tab-muted-changed';
  muted: boolean;
}
