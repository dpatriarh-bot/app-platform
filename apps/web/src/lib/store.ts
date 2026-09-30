// ============================================================
// store.ts — минимальный реактивный store
// Роль partner, consentVersion у user.
// ============================================================

export interface AppState {
  user: {
    id: string;
    role: 'parent' | 'partner' | 'manager' | 'curator' | 'admin' | 'superadmin';
    status: string;
    phone: string;
    email: string | null;
    totpEnabled: boolean;
    consentVersion: string | null;
  } | null;
  children: Array<{
    id: string;
    fullName: string;
    birthDate: string;
    age: number;
    grade: number | null;
    balance: number;
  }>;
  currentChildId: string | null;
  notificationsUnread: number;
  subscription: {
    status: string;
    planName: string;
    priceRub: number;
    daysLeft: number | null;
    autoRenew: boolean;
  } | null;
  partner: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    status: string;
  } | null;
  loading: boolean;
  bootstrapped: boolean;
}

const initialState: AppState = {
  user: null,
  children: [],
  currentChildId: null,
  notificationsUnread: 0,
  subscription: null,
  partner: null,
  loading: false,
  bootstrapped: false,
};

type Listener = (state: AppState) => void;

class Store {
  private state: AppState = { ...initialState };
  private listeners = new Set<Listener>();

  getState(): AppState {
    return this.state;
  }

  setState(partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
    const patch = typeof partial === 'function' ? partial(this.state) : partial;
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  reset(): void {
    this.state = { ...initialState };
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('store listener error', err);
      }
    }
  }
}

export const store = new Store();

if (typeof window !== 'undefined') {
  (window as unknown as { __ulybka_store: Store }).__ulybka_store = store;
}

export function selectCurrentChild(s: AppState) {
  if (!s.currentChildId) return null;
  return s.children.find((c) => c.id === s.currentChildId) ?? null;
}

export function selectIsAuthenticated(s: AppState): boolean {
  return s.user !== null;
}

export function selectIsStaff(s: AppState): boolean {
  if (!s.user) return false;
  return ['manager', 'curator', 'admin', 'superadmin'].includes(s.user.role);
}

export function selectIsPartner(s: AppState): boolean {
  return s.user?.role === 'partner';
}