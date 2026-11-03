import { tmpdir } from 'node:os'

const home = process.env.HOME ?? process.env.USERPROFILE ?? tmpdir()

export const ARCHITECT_DIR = `${home}/.architect`

export const SOCKET_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\architect'
    : `${ARCHITECT_DIR}/sock`

export const SETTINGS_PATH = `${ARCHITECT_DIR}/settings.json`
