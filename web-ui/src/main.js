import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import FolderItem from './components/FolderItem.vue'

const app = createApp(App)
app.component('FolderItem', FolderItem)
app.mount('#app')
