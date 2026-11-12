import type { Tile } from './place'

export function hit(tiles: Tile[], x: number, y: number): { at: number; top: number } {
  for (let at = tiles.length - 1; at >= 0; at--) {
    const tile = tiles[at] as Tile
    if (x < tile.x || x >= tile.x + tile.w || y < tile.y || y >= tile.y + tile.h) continue
    let top = at
    while ((tiles[top] as Tile).parent >= 0) top = (tiles[top] as Tile).parent
    return { at, top }
  }
  return { at: -1, top: -1 }
}
