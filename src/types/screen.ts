export interface ScreenState {
  label: string;
  triggeredBy: string;
  screenshotPath: string;
  screenshotBase64: string;
}

export interface DiscoveredScreen {
  url: string;
  path: string;
  title: string;
  screenshotPath: string;
  screenshotBase64: string;
  depth: number;
  parentPath?: string;
  states?: ScreenState[];
}

export type UIElementType =
  | "button"
  | "form"
  | "table"
  | "chart"
  | "modal"
  | "dropdown"
  | "input"
  | "tab"
  | "menu"
  | "filter"
  | "other";

export interface UIElement {
  type: UIElementType;
  label: string;
  description: string;
  action?: string;
  /** LLM (screenAnalyzer) bu öğenin sol sidebar / üst nav gibi GLOBAL
   *  navigasyon olduğunu ve **bu ekranın parçası değil**, başka bir
   *  ekrana götürdüğünü işaretler. Doküman üretimi + coverage hesabı
   *  bu işaretliyse öğeyi atlar. Hedef uygulamadan bağımsız çalışır
   *  (önceden hardcoded liste vardı; tek bir spor bahis ürününe
   *  kilitliydi). Eski/cached analizlerde undefined olabilir →
   *  isSidebarNav hardcoded hint listesine fallback yapar. */
  isGlobalNav?: boolean;
}

export interface Workflow {
  name: string;
  trigger?: string;
  steps: string[];
}

export interface ScreenAnalysis {
  screenTitle: string;
  purpose: string;
  targetAudience?: string;
  uiElements: UIElement[];
  workflows: Workflow[];
  dataDisplayed: string[];
  navigationOptions: string[];
}
