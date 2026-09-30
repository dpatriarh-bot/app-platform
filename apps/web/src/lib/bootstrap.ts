// ============================================================
// bootstrap.ts — загрузка состояния пользователя
// Для partner — тянем /partner/me, сохраняем в store.partner.
// ============================================================

import { api, isApiError } from './api.js';
import { store } from './store.js';

interface ChildFromApi {
  id: string;
  fullName: string;
  birthDate: string;
  age: number;
  grade: number | null;
  balance: number;
}

interface SubscriptionInfo {
  status: string;
  planName: string;
  priceRub: number;
  daysLeft: number | null;
  autoRenew: boolean;
}

interface PartnerInfo {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  status: string;
}

const LS_KEY = 'ulybka:currentChildId';

function getSavedChildId(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function saveChildId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

let bootstrapping: Promise<void> | null = null;

export async function bootstrapUserState(): Promise<void> {
  if (bootstrapping) return bootstrapping;

  bootstrapping = (async () => {
    const state = store.getState();
    if (!state.user) return;

    if (state.user.role === 'parent') {
      try {
        const [childrenRes, subRes, notifRes] = await Promise.allSettled([
          api.get<{ children: ChildFromApi[] }>('/me/children'),
          api.get<{ subscription: SubscriptionInfo | null }>('/payments/subscription'),
          api.get<{ count: number }>('/notifications/count'),
        ]);

        const children = childrenRes.status === 'fulfilled' ? childrenRes.value.children : [];
        const subscription = subRes.status === 'fulfilled' ? subRes.value.subscription : null;
        const unread = notifRes.status === 'fulfilled' ? notifRes.value.count : 0;

        const currentState = store.getState();
        const saved = getSavedChildId();

        let currentChildId: string | null = null;

        if (currentState.currentChildId && children.some((c) => c.id === currentState.currentChildId)) {
          currentChildId = currentState.currentChildId;
        } else if (saved && children.some((c) => c.id === saved)) {
          currentChildId = saved;
        } else if (children.length > 0) {
          currentChildId = children[0]!.id;
        }

        if (currentChildId) saveChildId(currentChildId);

        store.setState({
          children,
          subscription,
          notificationsUnread: unread,
          currentChildId,
          bootstrapped: true,
        });
      } catch (err) {
        if (isApiError(err) && err.status === 401) {
          store.setState({ user: null, bootstrapped: true });
        } else {
          // eslint-disable-next-line no-console
          console.warn('bootstrapUserState (parent) failed', err);
          store.setState({ bootstrapped: true });
        }
      }
    } else if (state.user.role === 'partner') {
      try {
        const res = await api.get<{ partner: PartnerInfo }>('/partner/me');
        store.setState({
          partner: {
            id: res.partner.id,
            slug: res.partner.slug,
            name: res.partner.name,
            logoUrl: res.partner.logoUrl,
            status: res.partner.status,
          },
          bootstrapped: true,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('bootstrapUserState (partner) failed', err);
        store.setState({ bootstrapped: true });
      }
    } else {
      store.setState({ bootstrapped: true });
    }
  })();

  return bootstrapping;
}

export function resetBootstrap(): void {
  bootstrapping = null;
}