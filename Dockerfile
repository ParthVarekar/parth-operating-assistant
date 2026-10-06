FROM node:24-alpine

# Set working directory
WORKDIR /app

# Install build dependencies if native bindings are required
RUN apk add --no-cache python3 make g++

# Copy package configurations
COPY package*.json ./

# Install dependencies cleanly
RUN npm install

# Copy source code and configurations
COPY . .

# Ensure data directory exists
RUN mkdir -p data

# Expose Render web port
EXPOSE 3000

# Start assistant daemon + Hanzo web dashboard
CMD ["npm", "start"]
