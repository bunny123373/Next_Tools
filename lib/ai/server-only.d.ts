/**
 * Minimal ambient declaration for the `server-only` marker.
 *
 * Next.js ships `server-only` inside `next/dist/compiled/server-only` and aliases
 * the bare specifier to it in both the server and client webpack/Turbopack
 * layers, so `import "server-only"` works at build time without the package
 * being a direct dependency. What it does *not* ship is a type declaration, and
 * this repository is not allowed to add npm dependencies, so we declare the
 * module here instead.
 *
 * The import is a side-effect-only marker: it has no runtime value, which is
 * exactly what the shorthand ambient module expresses. On the client layer the
 * alias resolves to a module that throws, which turns an accidental import of
 * `lib/ai/provider.ts` into a build failure rather than a leaked API key.
 */
declare module "server-only";
