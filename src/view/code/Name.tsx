import { Fragment } from 'react'

const BOUNDARY = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})|(?<=[^._\-/$:][._\-/$:]+)(?=[^._\-/$:])/u

export function wordParts(name: string): string[] {
  return name.split(BOUNDARY)
}

export default function Name({ text }: { text: string }) {
  return (
    <>
      {wordParts(text).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  )
}
