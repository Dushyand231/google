/**
 * Web stand-in for expo-sqlite.
 *
 * expo-sqlite's web build imports a wa-sqlite .wasm asset that is not shipped
 * in the package, so merely referencing the module fails the web bundle even
 * though the app never calls it on web (getStore picks the in-memory adapter
 * first). metro.config.js points `expo-sqlite` here on web to keep the bundle
 * clean and honest about the fact that web persistence is not supported yet.
 */
export function openDatabaseAsync(): Promise<never> {
  throw new Error('expo-sqlite is not available on web');
}
export function openDatabaseSync(): never {
  throw new Error('expo-sqlite is not available on web');
}
