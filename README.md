# CSuite: Your Virtual AI Boardroom

## Local Development & Setup

Follow these steps to set up and run the application locally:

### 1. Clone the Repository & Install Dependencies
```bash
git clone https://github.com/LeninPrakash41/cteam.git
cd cteam
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and configure your API keys (e.g., Firebase, Gemini API credentials).

### 3. Run the Development Server
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:5000` (or the local port shown in your terminal).

## Reproducible Testing Instructions

To thoroughly test the application and its features, please follow these step-by-step instructions:

### 1. Access the Application
- Open your browser to `http://localhost:5000` (or your local development URL).
- Click on **"Get Started"** or **"Login"** to authenticate using your Google account.

### 2. Onboarding (First-time users)
- If this is your first time logging in, you will be directed to the Onboarding screen.
- Enter a **Company Name** (e.g., "Acme Corp").
- Select an **Industry** and **Category** from the dropdowns.
- Provide a brief description of your startup and its current challenges.
- Click **"Generate C-Suite"**. The AI will assemble a specialized executive team based on your inputs.

### 3. Workspace Dashboard
- Once onboarded, you will land on the Dashboard.
- **Verify Company Info:** Check that your company details and board size are correctly displayed.
- **Action Items:** Test the action items by adding a new task, toggling its completion status, and deleting it.
- **Edit Description:** Try editing your company description using the pencil icon.

### 4. The Boardroom (Voice & Text Chat)
- Navigate to the **Boardroom** via the sidebar or the dashboard link.
- **Text Chat:** Type a message or question in the input box and press send. Verify that the AI executives respond contextually.
- **Voice Discussion:** 
  - Click **"Start Voice Discussion"** (ensure you grant microphone permissions in your browser).
  - Speak naturally to your board. You can interrupt them while they are speaking, and they will adapt to your interruptions.
  - Check the visualizer on your "Founder" tile to ensure your microphone input is being registered.
- **Resource Sharing:** Click the "+" icon next to the chat input to share a link or upload a text/markdown file. Verify that the board acknowledges and discusses the shared content.

### 5. Strategic Goals
- Navigate to the **Goals** section from the sidebar.
- Enter a high-level objective (e.g., "Expand market share by 15%").
- Click **"Generate SMART Goals & KPIs"**.
- Verify that the AI generates actionable SMART goals and KPIs.
- Test toggling the completion status of these goals and KPIs to see the celebration animations.

### 6. The Board (Team Profiles)
- Navigate to the **Team** section.
- Review the generated profiles, roles, bios, and expertise of your AI executive team.
- Test the "Regenerate Avatar" button on any agent's card to ensure the avatar updates correctly.
