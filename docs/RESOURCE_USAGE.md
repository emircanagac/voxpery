# Resource Usage

How much a Voxpery server uses, measured on the hosted service at voxpery.com. These are single measurements on one server, not a benchmark; your numbers depend on how many people are online, in voice and sharing their screen.

## Server

voxpery.com runs the Docker Compose stack from this repository on one Hetzner cloud server with 4 vCPUs, 8 GB of RAM, 80 GB of local disk and 20 TB of traffic, listed at €7.99 a month in the provider's panel (November 2026). The stack needs far less than this server offers.

## Method

Memory and CPU per container were read with `docker stats --no-stream` on the production server on 2026-11-21.

## Results

| Situation | server | PostgreSQL | LiveKit | Redis | web | Stack without ClamAV |
| --- | --- | --- | --- | --- | --- | --- |
| Idle, nobody connected | 117 MB | 57 MB | 49 MB | 9 MB | 6 MB | about 240 MB |
| One or two people connected | 117 MB | 77 MB | 55 MB | 9 MB | 6 MB | about 265 MB |
| Five people in voice (four in one channel, one in another) | 134 MB | 132 MB | 69 MB | 9 MB | 6 MB | about 350 MB |

- CPU stayed below 1% per container while idle and peaked at about 10% for LiveKit with five people in voice.
- The optional ClamAV file scanner (`security` profile) used about 1 GB on its own, about 80% of the stack's memory. It runs only on x86-64.
- Screen sharing was not part of this measurement. LiveKit forwards video without decoding it, so it mostly adds network traffic rather than server CPU; this has not been measured yet.

## What to plan for

1 GB of RAM is a comfortable minimum without ClamAV and 2 GB with it, leaving room for the operating system. The [deployment guide](DEPLOYMENT.md) lists the full requirements.
