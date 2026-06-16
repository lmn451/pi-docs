declare module "picomatch" {
  interface PicomatchOptions {
    dot?: boolean;
  }

  type Matcher = (input: string) => boolean;

  function picomatch(
    patterns: string | string[],
    options?: PicomatchOptions,
  ): Matcher;

  export default picomatch;
}
