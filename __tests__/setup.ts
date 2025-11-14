// Polyfill for File API (required by testcontainers on Node < 20)
if (typeof global.File === 'undefined') {
  // @ts-ignore
  global.File = class File {
    constructor(bits: any[], name: string, options?: any) {
      // Minimal implementation for testcontainers
      return new Blob(bits, options) as any;
    }
  };
}

// Polyfill for FormData if needed
if (typeof global.FormData === 'undefined') {
  // @ts-ignore
  global.FormData = class FormData {
    private data = new Map();
    
    append(name: string, value: any) {
      this.data.set(name, value);
    }
    
    get(name: string) {
      return this.data.get(name);
    }
  };
}
