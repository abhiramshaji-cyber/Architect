import { tmpdir } from 'node:os'

const home = process.env.HOME ?? process.env.USERPROFILE ?? tmpdir()

export const SOCKET_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\architect'
    : `${home}/.architect/sock`
