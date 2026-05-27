# Hosting Sniper Trader on Google Cloud Platform (GCP)

This guide provides step-by-step instructions to build, upload, and deploy your **Sniper Trader** application to a persistent **Google Compute Engine (GCE)** VM instance.

---

## Prerequisites
1. A **Google Cloud Platform (GCP)** account.
2. The **Docker** CLI installed on your local development machine.
3. If using Google's native container registry: **Google Cloud SDK (gcloud CLI)** installed locally.
   - If you do not want to install `gcloud`, you can use **Docker Hub** (free account) to host your container image.

---

## Phase 1: Build & Push the Docker Container

Choose either **Option A (Docker Hub)** or **Option B (Google Artifact Registry)** to host your image.

### Option A: Using Docker Hub (Recommended for Simplicity)
1. **Login to Docker Hub** in your local terminal:
   ```bash
   docker login
   ```
2. **Build the container image**:
   Replace `your_dockerhub_username` with your actual Docker Hub username. Run this command from your project root:
   ```bash
   docker build -t your_dockerhub_username/sniper-trader:latest .
   ```
3. **Push the image to Docker Hub**:
   ```bash
   docker push your_dockerhub_username/sniper-trader:latest
   ```

---

### Option B: Using Google Artifact Registry (GCP Native)
1. **Enable Artifact Registry**:
   Go to the [GCP Console](https://console.cloud.google.com/), search for **Artifact Registry**, and click **Enable**.
2. **Create a Repository**:
   - Click **+ Create Repository**.
   - **Name**: `sniper-trader-repo`
   - **Format**: `Docker`
   - **Location Type**: `Region` (choose a region close to you, e.g., `us-central1` or `asia-east1`)
   - Click **Create**.
3. **Authenticate your local Docker CLI with GCP**:
   Run this in your terminal:
   ```bash
   gcloud auth configure-docker <region>-docker.pkg.dev
   ```
   *(e.g., `gcloud auth configure-docker us-central1-docker.pkg.dev`)*
4. **Build and Tag the image**:
   ```bash
   docker build -t <region>-docker.pkg.dev/<gcp-project-id>/sniper-trader-repo/sniper-trader:latest .
   ```
5. **Push the image to GCP**:
   ```bash
   docker push <region>-docker.pkg.dev/<gcp-project-id>/sniper-trader-repo/sniper-trader:latest
   ```

---

## Phase 2: Create a Compute Engine VM

Since the "Deploy Container" checkboxes in GCP can sometimes be hidden, nested, or change depending on the machine family selected, we will use a **foolproof, 100% reliable method**: creating a standard VM and using a **Startup Script** to automatically install Docker, set up persistence, and run the container.

---

### Method 1: Standard VM with Startup Script (Easiest & Recommended)

This method works on any standard VM (Debian/Ubuntu) and handles all Docker commands, volume mounts, port mapping, and environment variables automatically.

1. **Go to VM Instances**:
   In the GCP Console, search for **Compute Engine** and select **VM instances**. Click **Create Instance**.
2. **Configure Instance**:
   - **Name**: `sniper-trader-vm`
   - **Region / Zone**: Choose a region close to you.
   - **Machine type**: Select **e2-micro** (free tier) or **e2-small** (recommended).
   - **Boot disk**: Ensure it is the default (Debian GNU/Linux) or change to Ubuntu.
3. **Configure Firewall**:
   - Check **"Allow HTTP traffic"**
   - Check **"Allow HTTPS traffic"**
4. **Add the Startup Script (The Magic Step)**:
   - Scroll down to the bottom of the page and expand **Advanced options** (or **"Management, security, disks, networking, sole tenancy"**).
   - Click the **Management** tab.
   - Find the **Startup script** text field and paste the following script:

   ```bash
   #!/bin/bash
   # Wait for background system updates to release the apt lock
   until apt-get update; do
       echo "Waiting for package manager lock to release..."
       sleep 5
   done

   # 1. Install Docker
   apt-get install -y docker.io

   # 2. Create persistent directory on the VM for the SQLite database
   mkdir -p /var/sniper-trader/data
   chmod 777 /var/sniper-trader/data

   # 3. Pull your Docker image
   # (Replace with your actual Docker Hub username or Artifact Registry path)
   docker pull your_dockerhub_username/sniper-trader:latest

   # 4. Stop any old container instance if it exists
   docker stop sniper-trader || true
   docker rm sniper-trader || true

   # 5. Run the container on port 80 with persistent data and configuration env variables
   docker run -d \
     --name sniper-trader \
     --restart always \
     -p 80:3000 \
     -v /var/sniper-trader/data:/app/data \
     -e NODE_ENV=production \
     -e PORT=3000 \
     -e JWT_SECRET="GENERATE_A_SECURE_RANDOM_JWT_SECRET" \
     -e ENCRYPTION_KEY="GENERATE_A_64_CHAR_HEX_ENCRYPTION_KEY" \
     -e GEMINI_API_KEY="YOUR_GEMINI_API_KEY" \
     your_dockerhub_username/sniper-trader:latest
   ```

   > [!IMPORTANT]
   > **How to find/replace these values:**
   > - `your_dockerhub_username`: Your personal username on [Docker Hub](https://hub.docker.com/) (e.g. `tazimsheikh`).
   > - `GENERATE_A_SECURE_RANDOM_JWT_SECRET`: You can copy this value directly from the `JWT_SECRET` line in your local `.env` file in the project folder.
   > - `GENERATE_A_64_CHAR_HEX_ENCRYPTION_KEY`: You can copy this value directly from the `ENCRYPTION_KEY` line in your local `.env` file.
   > - `YOUR_GEMINI_API_KEY`: You can copy this value directly from the `GEMINI_API_KEY` line in your local `.env` file.

5. **Launch VM**:
   - Click **Create** at the bottom of the page.
   - It will take about 2-3 minutes to boot, install Docker, fetch your image, and spin it up.
   - Copy the **External IP** address of the instance from the VM instances list and open it in your browser:
     `http://<your-vm-external-ip>`

---

### Method 2: Native Container Deployment (If you prefer to find the hidden Console settings)

If you still want to use Google's native container-deployment configuration:
1. In the **Create Instance** screen, look under **Machine configuration** (where you select CPU and memory size).
2. Right below the machine type selector, look for a small section called **"Container"**.
3. Click the **"DEPLOY CONTAINER"** button (or check the checkbox for **"Deploy a container image to this VM instance"**).
4. In the dialog box:
   - **Container image**: `your_dockerhub_username/sniper-trader:latest`
5. To configure **Advanced Container Options (Volume Mount & Env)**:
   - In that same dialog box, expand **"Advanced container options"** at the bottom.
   - Find **Volume Mounts**: Click **Add volume**, select type `Directory`, host path `/var/sniper-trader/data`, mount path `/app/data`.
   - Find **Environment Variables**: Add key-value pairs for `JWT_SECRET`, `ENCRYPTION_KEY`, `GEMINI_API_KEY`, etc.
   - Click **Select** / **Done**.
6. **Route traffic**:
   - Since native container deployment runs the container on port `3000`, you must add a startup script under **Advanced Options > Management > Startup script** to route port 80 to 3000:
     ```bash
     #!/bin/bash
     iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000
     ```
7. Click **Create** to launch.

---

## Phase 4: Add a Domain Name & SSL (HTTPS) for Production

To make the app publicly accessible via a domain name (like `yourdomain.com`) and secure it using HTTPS (which is **mandatory** for Google OAuth 2.0 to work in production), follow these steps:

### Step 1: Make the VM's External IP Static
By default, your VM IP is ephemeral and can change if the VM restarts.
1. Search for **VPC Network** in the GCP Console, and select **IP addresses**.
2. Find the IP address assigned to `sniper-trader-vm`.
3. Under the **Type** column, click **Ephemeral** and change it to **Static**. Give it a name and reserve it.

### Step 2: Configure DNS A Record with your Domain Registrar
Log in to the service where you bought your domain (e.g. Namecheap, GoDaddy, Squarespace, Cloudflare):
1. Navigate to your domain's **DNS Management** panel.
2. Add an **A Record**:
   - **Type**: `A`
   - **Host/Name**: `@` *(representing your main domain)*
   - **Value/Points to**: Paste the **Static External IP** of your GCP VM.
3. Add a second **A Record** (Optional):
   - **Type**: `A`
   - **Host/Name**: `www`
   - **Value/Points to**: Paste the **Static External IP** of your GCP VM.
   *(Wait 5-10 minutes for DNS propagation)*

### Step 3: Run the VM with Nginx & SSL Automation
To automatically set up a reverse proxy and secure the website with free SSL (Let's Encrypt), update your VM's **Startup script** in GCP Console:

1. Click on your VM instance (`sniper-trader-vm`) in Compute Engine and click **Edit**.
2. Scroll to **Metadata** -> **Startup script** and replace the old script with this production script:

```bash
#!/bin/bash
# Wait for background system updates to release the apt lock
until apt-get update; do
    echo "Waiting for package manager lock to release..."
    sleep 5
done

# 1. Install Docker, Nginx, and Certbot
apt-get install -y docker.io nginx certbot python3-certbot-nginx

# 2. Configure Nginx as a reverse proxy
cat << 'EOF' > /etc/nginx/sites-available/default
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com; # <-- REPLACE WITH YOUR DOMAIN

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Restart Nginx to load configuration
systemctl restart nginx

# 3. Create persistent directory on the VM for the SQLite database
mkdir -p /var/sniper-trader/data
chmod 777 /var/sniper-trader/data

# 4. Pull your Docker image
docker pull your_dockerhub_username/sniper-trader:latest

# 5. Stop any old container instance
docker stop sniper-trader || true
docker rm sniper-trader || true

# 6. Run the container on port 3000 (Nginx proxies port 80 to 3000)
docker run -d \
  --name sniper-trader \
  --restart always \
  -p 3000:3000 \
  -v /var/sniper-trader/data:/app/data \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e JWT_SECRET="GENERATE_A_SECURE_RANDOM_JWT_SECRET" \
  -e ENCRYPTION_KEY="GENERATE_A_64_CHAR_HEX_ENCRYPTION_KEY" \
  -e GEMINI_API_KEY="YOUR_GEMINI_API_KEY" \
  your_dockerhub_username/sniper-trader:latest
```

*Note: Be sure to change `yourdomain.com` and `www.yourdomain.com` inside the script to your actual domain name.*

3. Save the edits and click **Reset** (reboot) on the VM instance to run the new script.

### Step 4: Generate the Free SSL Certificate
Once the VM boots up and Nginx starts, you need to run Certbot to configure HTTPS:
1. In the Compute Engine console, click the **SSH** button next to your VM instance to open a terminal.
2. Run this command (replace with your domain and email):
   ```bash
   sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com --non-interactive --agree-tos -m your-email@domain.com
   ```
3. Certbot will coordinate with Let's Encrypt to verify your domain ownership, automatically obtain your SSL certificates, configure Nginx, and reload.

You can now access your application securely at **`https://yourdomain.com`**!
