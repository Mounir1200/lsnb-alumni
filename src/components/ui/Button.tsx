import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "light" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const buttonClass = (variant: ButtonVariant, size: ButtonSize) =>
  cn(
    "button",
    `button--${variant}`,
    `button--${size}`,
  );

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClass(variant, size), className)}
      {...props}
    />
  );
}

type ButtonLinkProps = {
  to: string;
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  "aria-label"?: string;
};

export function ButtonLink({
  to,
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      to={to}
      className={cn(buttonClass(variant, size), className)}
      {...props}
    >
      {children}
    </Link>
  );
}
