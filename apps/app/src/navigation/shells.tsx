/**
 * Navigation je Rolle (docs/ansichten-und-routen.md, Abschnitt 1):
 * - Kunde: Telefon unten 5 Reiter (Start, Fahrzeuge, Aufträge, Nachrichten, Mehr),
 *   ab Tablet Kopfleiste.
 * - Werkstatt: Seitenleiste ab 1024 px, darunter unten 5 Reiter.
 * - Mechaniker: 3 Reiter (Heute, Synchronisierung, Konto).
 */
import { routes } from '@werkstatt/contracts';
import { Stack, router, usePathname, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../auth/session';
import { useApiQuery } from '../data/hooks';
import { useIsOffline } from '../data/network';
import { useBreakpoint, useTheme } from '../theme';
import { AppText, Icon, iconSize, ListGroup, ListRow, OfflineBanner, Sheet, type IconName } from '../ui';

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  match: (path: string) => boolean;
  badge?: number;
}

const go = (href: string) => router.navigate(href as Href);

function Badge({ count, inline }: { count: number; inline?: boolean }) {
  const t = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, inline ? styles.badgeInline : null, { backgroundColor: t.colors.danger, borderRadius: t.radius.pill, borderColor: t.colors.surface }]} accessibilityElementsHidden aria-hidden>
      <AppText variant="caption" numeric style={{ color: t.scheme === 'dark' ? t.colors.bg : '#FFFFFE', fontSize: 11, lineHeight: 14 }}>
        {count > 9 ? '9+' : count}
      </AppText>
    </View>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.brand} accessibilityRole="header">
      <View style={[styles.brandMark, { backgroundColor: t.colors.accent, borderRadius: t.radius.control }]}>
        <Icon name="Wrench" size={iconSize.md} color={t.colors.accentText} />
      </View>
      {!compact ? (
        <AppText variant="bodyStrong" numberOfLines={2} style={{ flexShrink: 1 }}>
          Autowerkstatt Witten
        </AppText>
      ) : null}
    </View>
  );
}

function BottomTabs({ items, onMore, moreActive, tall }: { items: NavItem[]; onMore?: () => void; moreActive?: boolean; tall?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const all = onMore ? [...items, { key: 'mehr', label: 'Mehr', icon: 'DotsThreeOutline' as IconName, href: '', match: () => !!moreActive }] : items;
  return (
    <View role="navigation" aria-label="Hauptnavigation" style={[styles.bottom, { backgroundColor: t.colors.surface, borderTopColor: t.colors.border, paddingBottom: Math.max(insets.bottom, 4) }]}>
      {all.map((item) => {
        const active = item.match(path);
        const color = active ? t.colors.accent : t.colors.textMuted;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            aria-current={active ? 'page' : undefined}
            accessibilityLabel={item.badge ? `${item.label}, ${item.badge} ungelesen` : item.label}
            testID={`reiter-${item.key}`}
            onPress={() => (item.key === 'mehr' ? onMore?.() : go(item.href))}
            android_ripple={{ color: t.colors.overlay, borderless: true }}
            style={(s: PressState) => [styles.tabItem, { minHeight: tall ? 64 : 56 }, s.pressed ? { opacity: 0.75 } : null]}
          >
            <View style={[styles.tabIcon, { backgroundColor: active ? t.colors.accentSoft : 'transparent', borderRadius: t.radius.pill }]}>
              <Icon name={item.icon} size={iconSize.lg} color={color} />
              {item.badge ? <Badge count={item.badge} /> : null}
            </View>
            <AppText variant="caption" numberOfLines={1} style={{ color, fontSize: 12, lineHeight: 16, fontWeight: '500' }}>
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function TopBar({ items, onMore, moreActive, right }: { items: NavItem[]; onMore?: () => void; moreActive?: boolean; right?: ReactNode }) {
  const t = useTheme();
  const path = usePathname();
  const { device } = useBreakpoint();
  return (
    <View style={[styles.top, { backgroundColor: t.colors.surface, borderBottomColor: t.colors.border, paddingHorizontal: device === 'desktop' ? 32 : 24 }]}>
      <Brand compact={device !== 'desktop'} />
      <View role="navigation" aria-label="Hauptnavigation" style={styles.topNav}>
        {items.map((item) => {
          const active = item.match(path);
          return (
            <Pressable
              key={item.key}
              accessibilityRole="link"
              aria-current={active ? 'page' : undefined}
              accessibilityLabel={item.badge ? `${item.label}, ${item.badge} ungelesen` : item.label}
              testID={`nav-${item.key}`}
              onPress={() => go(item.href)}
              style={(s: PressState) => [
                styles.topItem,
                { borderBottomColor: active ? t.colors.accent : 'transparent' },
                s.hovered && !active ? { borderBottomColor: t.colors.borderStrong } : null,
              ]}
            >
              <AppText variant="body" tone={active ? 'accent' : 'default'} numberOfLines={1} style={{ fontWeight: active ? '600' : '500' }}>
                {item.label}
              </AppText>
              {item.badge ? <Badge count={item.badge} inline /> : null}
            </Pressable>
          );
        })}
        {onMore ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mehr"
            onPress={onMore}
            style={(s: PressState) => [styles.topItem, { borderBottomColor: moreActive ? t.colors.accent : 'transparent' }, s.hovered ? { opacity: 0.85 } : null]}
          >
            <AppText tone={moreActive ? 'accent' : 'default'} style={{ fontWeight: moreActive ? '600' : '500' }}>
              Mehr
            </AppText>
            <Icon name="CaretDown" size={iconSize.sm} color={moreActive ? t.colors.accent : t.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {right}
    </View>
  );
}

function AccountLink({ href }: { href: string }) {
  const t = useTheme();
  const { user } = useSession();
  const path = usePathname();
  const active = path === href;
  const first = user?.displayName.split(' ')[0] ?? 'Konto';
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Konto von ${user?.displayName ?? ''}`}
      testID="nav-konto"
      onPress={() => go(href)}
      style={(s: PressState) => [styles.account, { borderColor: active ? t.colors.accent : t.colors.border, borderRadius: t.radius.control }, s.hovered ? { borderColor: t.colors.accent } : null]}
    >
      <Icon name="UserCircle" size={iconSize.lg} color={active ? t.colors.accent : t.colors.textMuted} />
      <AppText numberOfLines={1} style={{ fontWeight: '500' }}>
        {first}
      </AppText>
    </Pressable>
  );
}

function MoreSheet({ visible, onClose, items, title = 'Mehr' }: { visible: boolean; onClose: () => void; items: NavItem[]; title?: string }) {
  const path = usePathname();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} width={440} testID="mehr-menue">
      <ListGroup>
        {items.map((item, i) => (
          <ListRow
            key={item.key}
            first={i === 0}
            icon={item.icon}
            title={item.label}
            subtitle={item.match(path) ? 'Aktuelle Ansicht' : null}
            testID={`mehr-${item.key}`}
            onPress={() => {
              onClose();
              go(item.href);
            }}
          />
        ))}
      </ListGroup>
    </Sheet>
  );
}

function AreaStack() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg }, animation: 'default' }} />;
}

// ---------------------------------------------------------------------------
// Kunde
// ---------------------------------------------------------------------------

export function CustomerShell() {
  const t = useTheme();
  const { device } = useBreakpoint();
  const path = usePathname();
  const offline = useIsOffline();
  const [more, setMore] = useState(false);
  const conversations = useApiQuery('shell:kunde:gespraeche', (api) => api.listConversations());
  const unread = conversations.data?.reduce((s, c) => s + c.unreadCount, 0) ?? 0;
  const R = routes.customer;

  const start: NavItem = { key: 'start', label: 'Start', icon: 'House', href: R.home(), match: (p) => p === '/kunde' || p === '/kunde/' };
  const vehicles: NavItem = { key: 'fahrzeuge', label: 'Fahrzeuge', icon: 'Car', href: R.vehicles(), match: (p) => p.startsWith('/kunde/fahrzeuge') };
  const orders: NavItem = { key: 'auftraege', label: 'Aufträge', icon: 'ClipboardText', href: R.workOrders(), match: (p) => p.startsWith('/kunde/auftraege') && !p.endsWith('/chat') };
  const messages: NavItem = { key: 'nachrichten', label: 'Nachrichten', icon: 'ChatCircleText', href: R.messages(), match: (p) => p.startsWith('/kunde/nachrichten') || (p.startsWith('/kunde/auftraege') && p.endsWith('/chat')), badge: unread };
  const appointments: NavItem = { key: 'termine', label: 'Termine', icon: 'CalendarBlank', href: R.appointments(), match: (p) => p.startsWith('/kunde/termine') };
  const documents: NavItem = { key: 'dokumente', label: 'Dokumente', icon: 'FileText', href: R.documents(), match: (p) => p.startsWith('/kunde/dokumente') };
  const invoices: NavItem = { key: 'rechnungen', label: 'Rechnungen', icon: 'Receipt', href: R.invoices(), match: (p) => p.startsWith('/kunde/rechnungen') };
  const account: NavItem = { key: 'konto', label: 'Konto', icon: 'UserCircle', href: R.account(), match: (p) => p.startsWith('/kunde/konto') };
  const moreItems = [appointments, documents, invoices, account];
  const moreActive = moreItems.some((i) => i.match(path));

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {device === 'desktop' ? (
        <TopBar items={[start, vehicles, orders, appointments, messages, documents, invoices]} right={<AccountLink href={R.account()} />} />
      ) : device === 'tablet' ? (
        <TopBar items={[start, vehicles, orders, messages]} onMore={() => setMore(true)} moreActive={moreActive} />
      ) : null}
      <OfflineBanner visible={offline} />
      <View style={styles.fill}>
        <AreaStack />
      </View>
      {device === 'phone' ? <BottomTabs items={[start, vehicles, orders, messages]} onMore={() => setMore(true)} moreActive={moreActive} /> : null}
      <MoreSheet visible={more} onClose={() => setMore(false)} items={moreItems} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Werkstatt
// ---------------------------------------------------------------------------

function workshopItems(isAdmin: boolean): { primary: NavItem[]; rest: NavItem[] } {
  const W = routes.workshop;
  const overview: NavItem = { key: 'uebersicht', label: 'Übersicht', icon: 'SquaresFour', href: W.home(), match: (p) => p === '/werkstatt' || p === '/werkstatt/' };
  const calendar: NavItem = { key: 'kalender', label: 'Kalender', icon: 'CalendarBlank', href: W.calendar(), match: (p) => p.startsWith('/werkstatt/kalender') || p.startsWith('/werkstatt/termine') };
  const orders: NavItem = { key: 'auftraege', label: 'Aufträge', icon: 'ClipboardText', href: W.workOrders(), match: (p) => p.startsWith('/werkstatt/auftraege') };
  const customers: NavItem = { key: 'kunden', label: 'Kunden', icon: 'Users', href: W.customers(), match: (p) => p.startsWith('/werkstatt/kunden') };
  const vehicles: NavItem = { key: 'fahrzeuge', label: 'Fahrzeuge', icon: 'Car', href: W.vehicles(), match: (p) => p.startsWith('/werkstatt/fahrzeuge') };
  const messages: NavItem = { key: 'nachrichten', label: 'Nachrichten', icon: 'ChatCircleText', href: W.messages(), match: (p) => p.startsWith('/werkstatt/nachrichten') };
  const invoices: NavItem = { key: 'rechnungen', label: 'Rechnungen', icon: 'Receipt', href: W.invoices(), match: (p) => p.startsWith('/werkstatt/rechnungen') };
  const maintenance: NavItem = { key: 'wartungen', label: 'Wartungen', icon: 'Gauge', href: W.maintenance(), match: (p) => p.startsWith('/werkstatt/wartungen') };
  const users: NavItem = { key: 'benutzer', label: 'Benutzer', icon: 'UserList', href: W.users(), match: (p) => p.startsWith('/werkstatt/benutzer') };
  const settings: NavItem = { key: 'einstellungen', label: 'Einstellungen', icon: 'Gear', href: W.settings(), match: (p) => p.startsWith('/werkstatt/einstellungen') };
  const audit: NavItem = { key: 'protokoll', label: 'Protokoll', icon: 'ClockCounterClockwise', href: W.audit(), match: (p) => p.startsWith('/werkstatt/protokoll') };
  const account: NavItem = { key: 'konto', label: 'Konto', icon: 'UserCircle', href: W.account(), match: (p) => p.startsWith('/werkstatt/konto') };
  const adminOnly = isAdmin ? [users, settings, audit] : [];
  return {
    primary: [overview, calendar, orders, customers, vehicles, messages, invoices, maintenance, ...adminOnly],
    rest: [customers, vehicles, invoices, maintenance, ...adminOnly, account],
  };
}

export function WorkshopShell() {
  const t = useTheme();
  const { device } = useBreakpoint();
  const { user, signOut } = useSession();
  const path = usePathname();
  const offline = useIsOffline();
  const [more, setMore] = useState(false);
  const { primary, rest } = workshopItems(user?.role === 'admin');
  const canMechanic = user?.permissions.includes('workItems.execute');

  // PC-Tastatur: Alt+1 bis Alt+9 öffnen die Hauptbereiche (docs/ansichten-und-routen.md)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number.parseInt(e.key, 10);
      const target = Number.isInteger(n) && n >= 1 ? primary[n - 1] : undefined;
      if (target) {
        e.preventDefault();
        go(target.href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [primary]);

  if (device === 'desktop') {
    return (
      <View style={[styles.fill, styles.rowFill, { backgroundColor: t.colors.bg }]}>
        <View style={[styles.sidebar, { backgroundColor: t.colors.surface, borderRightColor: t.colors.border }]}>
          <Brand />
          <ScrollView role="navigation" aria-label="Hauptnavigation" contentContainerStyle={styles.sideList}>
            {primary.map((item, index) => {
              const active = item.match(path);
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="link"
                  aria-current={active ? 'page' : undefined}
                  accessibilityLabel={`${item.label} (Alt+${index + 1})`}
                  testID={`nav-${item.key}`}
                  onPress={() => go(item.href)}
                  style={(s: PressState) => [
                    styles.sideItem,
                    { borderRadius: t.radius.control },
                    active ? { backgroundColor: t.colors.accentSoft } : s.hovered ? { backgroundColor: t.colors.surfaceSunken } : null,
                  ]}
                >
                  <Icon name={item.icon} size={iconSize.md} color={active ? t.colors.accent : t.colors.textMuted} />
                  <AppText tone={active ? 'accent' : 'default'} style={{ fontWeight: active ? '600' : '500' }} numberOfLines={1}>
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={[styles.sideFooter, { borderTopColor: t.colors.border }]}>
            {canMechanic ? (
              <Pressable accessibilityRole="link" onPress={() => go(routes.mechanic.home())} style={(s: PressState) => [styles.sideItem, { borderRadius: t.radius.control }, s.hovered ? { backgroundColor: t.colors.surfaceSunken } : null]}>
                <Icon name="Wrench" size={iconSize.md} color={t.colors.textMuted} />
                <AppText style={{ fontWeight: '500' }}>Mechanikeransicht</AppText>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="link" testID="nav-konto" onPress={() => go(routes.workshop.account())} style={(s: PressState) => [styles.sideItem, { borderRadius: t.radius.control }, s.hovered ? { backgroundColor: t.colors.surfaceSunken } : null]}>
              <Icon name="UserCircle" size={iconSize.md} color={t.colors.textMuted} />
              <View style={styles.fill}>
                <AppText numberOfLines={1} style={{ fontWeight: '500' }}>
                  {user?.displayName}
                </AppText>
                <AppText variant="caption" tone="subtle">
                  {user?.role === 'admin' ? 'Inhaber' : 'Service'}
                </AppText>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void signOut()} style={(s: PressState) => [styles.sideItem, { borderRadius: t.radius.control }, s.hovered ? { backgroundColor: t.colors.surfaceSunken } : null]}>
              <Icon name="SignOut" size={iconSize.md} color={t.colors.textMuted} />
              <AppText style={{ fontWeight: '500' }}>Abmelden</AppText>
            </Pressable>
          </View>
        </View>
        <View style={styles.fill}>
          <OfflineBanner visible={offline} />
          <AreaStack />
        </View>
      </View>
    );
  }

  const tabs = [primary[0]!, primary[1]!, primary[2]!, primary[5]!];
  const moreActive = rest.some((i) => i.match(path));
  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <OfflineBanner visible={offline} />
      <View style={styles.fill}>
        <AreaStack />
      </View>
      <BottomTabs items={tabs} onMore={() => setMore(true)} moreActive={moreActive} />
      <MoreSheet visible={more} onClose={() => setMore(false)} items={canMechanic ? [...rest, { key: 'mechaniker', label: 'Mechanikeransicht', icon: 'Wrench', href: routes.mechanic.home(), match: () => false }] : rest} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Mechaniker
// ---------------------------------------------------------------------------

export function MechanicShell() {
  const t = useTheme();
  const offline = useIsOffline();
  const M = routes.mechanic;
  const items: NavItem[] = [
    { key: 'heute', label: 'Heute', icon: 'Wrench', href: M.home(), match: (p) => p === '/mechaniker' || p.startsWith('/mechaniker/auftraege') },
    { key: 'sync', label: 'Synchronisierung', icon: 'ArrowsClockwise', href: M.sync(), match: (p) => p.startsWith('/mechaniker/sync') },
    { key: 'konto', label: 'Konto', icon: 'UserCircle', href: M.account(), match: (p) => p.startsWith('/mechaniker/konto') },
  ];
  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      <OfflineBanner visible={offline} variant="queue" />
      <View style={styles.fill}>
        <AreaStack />
      </View>
      <BottomTabs items={items} tall />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  rowFill: { flexDirection: 'row' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  brandMark: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  bottom: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 4 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2 },
  tabIcon: { width: 56, height: 30, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -2, right: 8, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  badgeInline: { position: 'relative', top: 0, right: 0, borderWidth: 0, minWidth: 20, height: 20 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 24, minHeight: 64, borderBottomWidth: 1 },
  topNav: { flex: 1, flexDirection: 'row', alignItems: 'stretch', gap: 4, minWidth: 0 },
  topItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 64, borderBottomWidth: 3, borderTopWidth: 3, borderTopColor: 'transparent' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 12, minHeight: 44 },
  sidebar: { width: 248, borderRightWidth: 1, paddingHorizontal: 12, paddingTop: 16, paddingBottom: 12, gap: 16 },
  sideList: { gap: 2 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, minHeight: 44 },
  sideFooter: { borderTopWidth: 1, paddingTop: 12, gap: 2 },
});
