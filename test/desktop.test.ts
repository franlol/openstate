import { expect, test } from "bun:test"
import { execArg, shArg } from "../src/desktop"

const paths = ["/usr/bin/openstate", "/Users/Ana María/my tools/openstate", `/tmp/it's "odd" $HOME \`x\` 100%\\bin`]

test("sh gets each path back as one word", () => {
  for (const p of paths) expect(Bun.spawnSync(["sh", "-c", `printf %s ${shArg(p)}`]).stdout.toString()).toBe(p)
})

test("desktop entries quote and escape the path", () => {
  expect(execArg("/Users/Ana María/openstate")).toBe('"/Users/Ana María/openstate"')
  expect(execArg('/a "b"/$c `d` 5%\\e')).toBe('"/a \\\\"b\\\\"/\\\\$c \\\\`d\\\\` 5%%\\\\\\\\e"')
})
