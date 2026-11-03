/** Bundled images resolve to an asset id that <Image source> accepts (Metro / jest-expo). */
declare module '*.png' {
  const asset: number;
  export default asset;
}
