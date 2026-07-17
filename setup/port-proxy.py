#!/usr/bin/env python3
import asyncio
import os

LISTEN_HOST = os.getenv('PROXY_LISTEN_HOST', '0.0.0.0')
LISTEN_PORT = int(os.getenv('PROXY_LISTEN_PORT', '8000'))
TARGET_HOST = os.getenv('PROXY_TARGET_HOST', '127.0.0.1')
TARGET_PORT = int(os.getenv('PROXY_TARGET_PORT', '8010'))

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
        server_reader, server_writer = await asyncio.open_connection(TARGET_HOST, TARGET_PORT)
    except Exception:
        client_writer.close()
        await client_writer.wait_closed()
        return
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
