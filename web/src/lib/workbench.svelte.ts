export type TabKind = 'file' | 'diff';
export type Tab = { key: string; kind: TabKind; path: string; dirty: boolean; conflict: boolean };
export type SidebarView = 'files' | 'search' | 'git';

const stored = (key: string, fallback: number) => Number(localStorage.getItem(key)) || fallback;

class Workbench {
  tabs = $state<Tab[]>([]);
  activeKey = $state<string | null>(null);
  sidebar = $state<SidebarView>('files');
  /** False hides the side panel; the activity bar stays. */
  sidebarOpen = $state(true);
  sidebarWidth = $state(stored('loupe.sidebarWidth', 260));
  reviewWidth = $state(Math.max(20, Math.min(70, stored('loupe.reviewWidth', 40))));
  panelOpen = $state(true);
  /** The panel fills the whole main area, hiding the editor. */
  panelMax = $state(false);
  panelHeight = $state(stored('loupe.panelHeight', 260));
  quickOpen = $state(false);
  searchFocus = $state(0);
  reveal = $state<{ path: string; line: number; column: number } | null>(null);
  workspaceName = $state('');
  workspaceRoot = '';

  get active(): Tab | null {
    return this.tabs.find((t) => t.key === this.activeKey) ?? null;
  }

  open(path: string, kind: TabKind = 'file', line?: number, column = 1) {
    const key = `${kind}:${path}`;
    if (!this.tabs.some((t) => t.key === key)) {
      const at = this.tabs.findIndex((t) => t.key === this.activeKey);
      this.tabs.splice(at + 1, 0, { key, kind, path, dirty: false, conflict: false });
    }
    this.activeKey = key;
    this.panelMax = false;
    if (line) this.reveal = { path, line, column };
  }

  close(key: string) {
    const i = this.tabs.findIndex((t) => t.key === key);
    if (i < 0) return;
    const tab = this.tabs[i];
    const otherTabs = this.tabs.filter((t) => t.path === tab.path && t.key !== key);
    if (tab.dirty && !otherTabs.length && !confirm(`${tab.path} has unsaved changes. Close anyway?`)) return;
    this.tabs.splice(i, 1);
    if (this.activeKey === key) this.activeKey = (this.tabs[i] ?? this.tabs[i - 1])?.key ?? null;
  }

  setSidebarWidth(px: number) {
    this.sidebarWidth = Math.max(160, Math.min(700, px));
    localStorage.setItem('loupe.sidebarWidth', String(this.sidebarWidth));
  }

  setReviewWidth(percent: number) {
    this.reviewWidth = Math.max(20, Math.min(70, percent));
    localStorage.setItem('loupe.reviewWidth', String(this.reviewWidth));
  }

  /** Hidden -> maximized -> half height -> hidden. */
  cyclePanel() {
    if (!this.panelOpen) {
      this.panelOpen = true;
      this.panelMax = true;
    } else if (this.panelMax) {
      this.panelMax = false;
      this.setPanelHeight(Math.round(window.innerHeight / 2));
    } else {
      this.hidePanel();
    }
  }

  hidePanel() {
    this.panelOpen = false;
    this.panelMax = false;
  }

  setPanelHeight(px: number) {
    this.panelHeight = Math.max(80, Math.min(window.innerHeight - 160, px));
    localStorage.setItem('loupe.panelHeight', String(this.panelHeight));
  }
}

export const wb = new Workbench();

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
