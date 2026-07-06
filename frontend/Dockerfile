FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css config.js /usr/share/nginx/html/
COPY js /usr/share/nginx/html/js

EXPOSE 80
