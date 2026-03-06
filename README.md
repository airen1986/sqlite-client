# Supply Chain Lite

Streamline your planning with lightweight, modern supply chain planning tools.


## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to `http://localhost:3000`

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## 📁 Project Structure

```
scl-neo/
├── src/
│   ├── scss/
│   │   ├── _variables.scss      # Custom Bootstrap variables
│   │   ├── _custom.scss          # Custom styles
│   │   └── styles.scss           # Main SCSS entry point
│   ├── js/
│   │   └── main.js               # JavaScript entry point
│   ├── index.html                # Home page
│   ├── login.html                # Login page
│   ├── signup.html               # Sign up page
│   ├── forgot-password.html      # Forgot password page
│   ├── reset-password.html       # Reset password page
├── vite.config.js                # Vite configuration
├── package.json
└── README.md
```

## 🎨 Customization

### Colors

Edit `src/scss/_variables.scss` to customize the color palette:

```scss
$primary: #6366f1;
$secondary: #a855f7;
$success: #10b981;
$danger: #ef4444;
// ... and more
```

## 🛠️ Technologies Used

- [Bootstrap 5.3.2](https://getbootstrap.com/)
- [Sass](https://sass-lang.com/)
- [Vite](https://vitejs.dev/)
- [Google Fonts (Inter)](https://fonts.google.com/specimen/Inter)

## 📝 License

MIT License - feel free to use this theme for personal and commercial projects.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

