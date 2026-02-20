# Raspberry Pi Headless Setup Guide

Use your Raspberry Pi without a monitor, keyboard, or mouse.

## What You Need

- Raspberry Pi (any model with networking)
- microSD card (16 GB+)
- Power supply for your Pi
- Another computer on the same network

## Method 1: Raspberry Pi Imager (Recommended)

The easiest way. Raspberry Pi Imager lets you pre-configure SSH, Wi-Fi, and
user credentials before the first boot.

### 1. Flash the SD Card

1. Download and install [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Select your Pi model and OS (Raspberry Pi OS Lite for headless, or full if you want VNC later)
3. Click the **gear icon** (or `Ctrl+Shift+X`) to open **OS Customization**:

| Setting              | Value                              |
|----------------------|------------------------------------|
| Hostname             | `raspberrypi` (or your choice)     |
| Enable SSH           | ✅ Use password authentication     |
| Set username/password| Pick something you'll remember     |
| Configure Wi-Fi      | Your network SSID and password     |
| Wi-Fi country        | Your country code (e.g. US, GB)    |

4. Write to the SD card

### 2. Boot the Pi

1. Insert the SD card into the Pi
2. Connect power (and Ethernet if not using Wi-Fi)
3. Wait ~60–90 seconds for the first boot

### 3. Connect via SSH

From a terminal on your other computer:

```bash
ssh <username>@raspberrypi.local
```

If `.local` doesn't resolve, find the Pi's IP address from your router's admin
page or use:

```bash
# Linux/macOS
ping raspberrypi.local

# Or scan the network (requires nmap)
nmap -sn 192.168.1.0/24
```

Then connect with the IP directly:

```bash
ssh <username>@192.168.1.XXX
```

## Method 2: Manual Configuration (No Imager)

If you flashed the OS another way, you can enable SSH and Wi-Fi by placing
files on the boot partition of the SD card before the first boot.

### Enable SSH

Create an empty file named `ssh` (no extension) in the boot partition:

```bash
touch /Volumes/bootfs/ssh        # macOS
touch /media/$USER/bootfs/ssh    # Linux
# On Windows, create an empty file named "ssh" in the boot drive
```

### Configure Wi-Fi

Create a file named `wpa_supplicant.conf` in the boot partition:

```
country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="YOUR_WIFI_NAME"
    psk="YOUR_WIFI_PASSWORD"
    key_mgmt=WPA-PSK
}
```

### Set Username and Password

Create a file named `userconf.txt` in the boot partition containing:

```
username:encrypted-password
```

Generate the encrypted password on another Linux machine:

```bash
echo 'mypassword' | openssl passwd -6 -stdin
```

Then your `userconf.txt` would look like:

```
pi:$6$xyz...your_hash_here
```

## Enabling VNC (Remote Desktop)

Once connected via SSH, enable VNC for full graphical access:

```bash
sudo raspi-config
# Navigate to: Interface Options → VNC → Enable
```

Then install [RealVNC Viewer](https://www.realvnc.com/en/connect/download/viewer/)
on your computer and connect to `raspberrypi.local`.

> **Note:** VNC requires Raspberry Pi OS with Desktop, not the Lite version.
> If you installed Lite, you can add a desktop with:
> ```bash
> sudo apt update && sudo apt install -y raspberrypi-ui-mods
> sudo reboot
> ```

## Useful Commands Once Connected

```bash
# Check Pi model and OS
cat /proc/device-tree/model
cat /etc/os-release

# Check network
hostname -I
iwconfig

# Update the system
sudo apt update && sudo apt full-upgrade -y

# Check temperature
vcgencmd measure_temp

# Safely shut down
sudo shutdown -h now

# Reboot
sudo reboot
```

## Troubleshooting

| Problem | Solution |
|---|---|
| Can't find Pi on network | Check Wi-Fi credentials; try Ethernet; check router DHCP leases |
| `ssh: connect to host raspberrypi.local port 22: Connection refused` | SSH not enabled — re-flash with Imager or add `ssh` file to boot partition |
| `.local` hostname doesn't resolve | Install Bonjour (Windows) or avahi (Linux): `sudo apt install avahi-daemon` |
| SSH works but VNC shows grey screen | Set a screen resolution: `sudo raspi-config` → Display Options → Resolution |
| Permission denied (publickey) | Use password auth: `ssh -o PreferredAuthentications=password user@host` |

## SSH Key Setup (Optional, More Secure)

To skip typing your password every time:

```bash
# On your computer — generate a key if you don't have one
ssh-keygen -t ed25519

# Copy your public key to the Pi
ssh-copy-id <username>@raspberrypi.local
```

Now `ssh <username>@raspberrypi.local` will connect without a password.
