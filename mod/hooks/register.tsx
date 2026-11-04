import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Register } from 'claude-code'
import { parseJson, relayLine, relayStatus } from '../../src/band.mjs'

const LOG = join(homedir(), '.local', 'state', 'jev-relay', 'relay.log')
const CONFIG = join(homedir(), '.config', 'jev-relay', 'config.json')

const readOr = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const status = relayStatus(parseJson(readOr(CONFIG)), readOr(LOG), await $.session.id())
    return (
      <Box key="jev-relay" flexDirection="row">
        <Text>{relayLine(status)}</Text>
      </Box>
    )
  })
}
