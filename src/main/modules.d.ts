// pdfjs-dist 的 exports 只为 pdf.mjs 提供类型；worker 模块按无类型声明导入，
// 我们只使用它挂到 globalThis.pdfjsWorker 供主线程内解析。
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
declare module '*?raw' {
  const content: string;
  export default content;
}
