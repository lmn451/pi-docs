declare module "picomatch" {
  interface PicomatchOptions {
    dot?: boolean;
    nobrace?: boolean;
    noglobstar?: boolean;
    noext?: boolean;
    nocase?: boolean;
    nonegate?: boolean;
    bash?: boolean;
    debug?: boolean;
    unescape?: boolean;
    contains?: boolean;
    matchBase?: boolean;
    strictSlashes?: boolean;
    windows?: boolean;
    maxLength?: number;
    onIgnore?: (glob: string, regex: RegExp) => void;
    onMatch?: (glob: string, result: RegExp | null) => void;
    onResult?: (glob: string, result: RegExp | null) => void;
  }

  type Matcher = (str: string) => boolean;

  function picomatch(patterns: string | string[], options?: PicomatchOptions): Matcher;

  namespace picomatch {
    function makeRe(pattern: string, options?: PicomatchOptions): RegExp;
    function scan(input: string, options?: PicomatchOptions): {
      base: string;
      glob: string;
      input: string;
      isBrace: boolean;
      isBracket: boolean;
      isGlob: boolean;
      isGlobstar: boolean;
      isExtglob: boolean;
      negated: boolean;
      prefix: string | null;
    };
  }

  export = picomatch;
}
