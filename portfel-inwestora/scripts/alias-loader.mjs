const projectRoot = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const sourceUrl = new URL(`src/${specifier.slice(2)}.ts`, projectRoot);
    return nextResolve(sourceUrl.href, context);
  }

  return nextResolve(specifier, context);
}
