import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { fontFamily } from './font';

self.MonacoEnvironment = {
  getWorker(_id, label) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

// Monaco's TS worker only sees open files, so semantic errors (unresolved imports etc.) are noise.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true });
}

export { monaco };

export const editorOptions: monaco.editor.IEditorOptions = {
  automaticLayout: true,
  fontFamily,
  fontLigatures: true,
  fontSize: 13,
  minimap: { enabled: false },
  stickyScroll: { enabled: false },
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  smoothScrolling: true,
};
