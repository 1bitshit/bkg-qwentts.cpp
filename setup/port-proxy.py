#!/usr/bin/env python3
import asyncio
import os

LISTEN_HOST = os.getenv('PROXY_LISTEN_HOST', '0.0.0.0')
LISTEN_PORT = int(os.getenv('PROXY_LISTEN_PORT', '8000'))
TARGET_HOST = os.getenv('PROXY_TARGET_HOST', '127.0.0.1')
TARGET_PORT = int(os.getenv('PROXY_TARGET_PORT', '8010'))
ALT_PREFIX = os.getenv('PROXY_ALT_PREFIX', '')
ALT_TARGET_PORT = int(os.getenv('PROXY_ALT_TARGET_PORT', '0') or 0)

async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

async def handle(client_reader, client_writer):
    try:
        first = await client_reader.readuntil(b'\r\n\r\n')
    except Exception:
        client_writer.close()
        return

    target_port = TARGET_PORT
    if ALT_PREFIX and ALT_TARGET_PORT:
        line_end = first.find(b'\r\n')
        parts = first[:line_end].decode('latin1').split(' ')
        if len(parts) >= 2 and parts[1].startswith(ALT_PREFIX):
            parts[1] = parts[1][len(ALT_PREFIX):] or '/'
            first = ' '.join(parts).encode('latin1') + first[line_end:]
            target_port = ALT_TARGET_PORT

    try:
        server_reader, server_writer = await asyncio.open_connection(TARGET_HOST, target_port)
    except Exception:
        client_writer.close()
        return

    server_writer.write(first)
    await server_writer.drain()
    await asyncio.gather(
        pipe(client_reader, server_writer),
        pipe(server_reader, client_writer),
    )

async def main():
    server = await asyncio.start_server(handle, LISTEN_HOST, LISTEN_PORT)
    print(f'proxy {LISTEN_HOST}:{LISTEN_PORT} -> {TARGET_HOST}:{TARGET_PORT}', flush=True)
    async with server:
        await server.serve_forever()

asyncio.run(main())
