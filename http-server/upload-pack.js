'use strict'
const pako = require('pako')
const { GitRepo, GitCommit } = require('../src/meshdb')
const pad = require('pad')

function writeObject ({stream, object}) {
  let type, lastFour, multibyte, length
  // Extract object type and length
  let [stype, slength] = object.split(' ', 2)
  object = object.replace(/^.+\0/, '')
  // Object type is encoded in bits 654
  if (stype === 'commit') type = 0b0010000
  if (stype === 'tree')   type = 0b0100000
  if (stype === 'blob')   type = 0b0110000
  if (stype === 'tag')    type = 0b1000000
  // The length encoding get complicated.
  length = parseInt(slength)
  // Whether the next byte is part of the variable-length encoded number
  // is encoded in bit 7
  multibyte = (length > 0b1111) ? 0b10000000 : 0b0
  // Last four bits of length is encoded in bits 3210
  lastFour = length & 0b1111
  // Discard those bits
  length = length >>> 4
  // The first byte is then (1-bit multibyte?), (3-bit type), (4-bit least sig 4-bits of length)
  let byte = (multibyte | type | lastFour).toString(16)
  stream.write(byte, 'hex')
  // Now we keep chopping away at length 7-bits at a time until its zero.
  let bytes = []
  while (multibyte > 0) {
    multibyte = (length > 0b01111111) ? 0b10000000 : 0b0
    bytes.push(multibyte | length & 0b01111111)
    length = length >>> 7
  }
  // Then we need to add the bytes in big-endian order.
  while (bytes.length > 0) {
    stream.write(bytes.shift().toString(16), 'hex')
  }
  // Lastly, we can compress and write the object.
  stream.write(Buffer.from(pako.deflate(object)))
}

class UploadPack {
  static async createPackfile ({repo, stream}) {
    let everything = await GitRepo.clone({repo})
    let objects = new Set()
    // Note: for now we can only pack commits because we have no blob or tree support anywhere yet.
    for (let o of everything) {
      if (o.key.startsWith(':objects:')) {
        if (o.value.startsWith('commit')) {
          objects.add(o)
        }
      }
    }
    // write to a buffer, then dump to stream
    stream.write('PACK')
    stream.write('00000002', 'hex')
    // Write a 4 byte (32-bit) int
    stream.write(pad(8, objects.size.toString(16), '0'), 'hex')
    for (let o of objects) {
      console.log(o.key)
      writeObject({stream, object: o.value})
    }
  }
}

async function test () {
  let stream = require('fs').createWriteStream(process.argv[2])
  await UploadPack.createPackfile({repo: 'meshdb/presentation', stream})
  stream.end()
}

if (!module.parent) test()
