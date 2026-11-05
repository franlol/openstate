// Files imported `with { type: "file" }`: Bun hands over a path, embedded in the compiled binary.
declare module "*.png" {
  const path: string
  export default path
}
declare module "*.wasm" {
  const path: string
  export default path
}
declare module "*.scm" {
  const path: string
  export default path
}
