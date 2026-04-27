# ANTI-NET ISP-Manager-System For MikroTik

# 🌐 ISP Manager System (User Manager)

![Version](https://img.shields.io/badge/Version-1.0.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Windows-lightgray.svg)
![Tech Stack](https://img.shields.io/badge/Tech-React_|_FastAPI_|_SQLite-success.svg)

## 📌 Overview
**ISP Manager** is a comprehensive, standalone desktop application engineered specifically for Internet Service Providers (ISPs) and Network Operations Center (NOC) teams. 

Developed to bridge the gap between network infrastructure and daily operations, this system provides a secure, user-friendly graphical interface to manage MikroTik routers, monitor active PPPoE/Hotspot users, and control technical support permissions without exposing direct Winbox access.

## 🚀 Key Features
* **MikroTik API Integration:** Direct, real-time communication with RouterOS for user provisioning and monitoring.
* **Role-Based Access Control (RBAC):** Distinct permission levels (Admin vs. Support) to ensure network security and prevent unauthorized configuration changes.
* **Local & Secure Database:** Utilizes an embedded SQLite database, ensuring all financial and subscriber data remains strictly local and portable.
* **Zero-Dependency Deployment:** Packaged as a standalone Windows executable (`.exe`) using PyInstaller and Inno Setup, requiring no prior Python or Node.js installations on the client's machine.
* **Modern UI/UX:** Built with React and TailwindCSS for a responsive, dark-themed dashboard.

## ⚠️ System Prerequisites
To ensure full functionality and seamless communication with your network hardware, the following requirements must be met:
* **RouterOS Version:** The target MikroTik router must be running **RouterOS v7.0 or higher**.
* **User Manager:** The MikroTik **User Manager** package must be installed, configured, and active on the router.

## 🛠️ Technology Stack
* **Backend:** Python 3.11, FastAPI, Uvicorn.
* **Frontend:** React.js, Vite, TailwindCSS.
* **Database:** SQLite (SQLAlchemy ORM).
* **Packaging:** PyInstaller, Inno Setup Compiler.

## 📥 Download & Installation
You can download the latest compiled version of the software without needing to build it from source.

1. Navigate to the [Releases](../../releases) tab on the right side of this repository.
2. Download the `ISP.Manager.Setup.exe` file.
3. Run the installer and follow the standard setup wizard.
4. The application server will start in the background and automatically open the dashboard in your default web browser.

**Default Credentials:**
* **Username:** admin
* **Password:** password123

---

## 👨‍💻 About the Developer
ENG.Abdulhamed.H
Developed by a Computer Engineering Technology graduate  with hands-on leadership experience in FTTH/GPON infrastructure and telecommunications. Currently pursuing advanced Cisco (CCNP) and MikroTik certifications, with a strong focus on network automation and NOC L2 operations.

If you are interested in network automation, IT infrastructure, or discussing NOC operations, feel free to connect!
